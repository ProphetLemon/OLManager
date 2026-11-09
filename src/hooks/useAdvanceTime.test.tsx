import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { GameStateData } from "../store/gameStore";
import { useAdvanceTime } from "./useAdvanceTime";
import { delegateScrimDecision } from "../services/trainingService";

const navigateMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../services/trainingService", () => ({
  delegateScrimDecision: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedDelegateScrimDecision = vi.mocked(delegateScrimDecision);

function HookHarness(props: {
  defaultMatchMode?: "live" | "spectator" | "delegate";
  scrimReviewMode?: "manual" | "assistant";
  hasMatchToday: boolean;
  isUnemployed?: boolean;
}): JSX.Element {
  const [, setGameState] = useState<GameStateData | null>(null);
  const {
    blockerModal,
    autoDelegationNotice,
    matchPlayedNotice,
    handleConfirmMatch,
    handleContinue,
    handleSkipToMatchDay,
    showMatchConfirm,
  } =
    useAdvanceTime(
      (state) => setGameState(state),
      props.hasMatchToday,
      props.defaultMatchMode,
      props.scrimReviewMode ?? "manual",
      true,
      props.isUnemployed ?? false,
    );

  return (
    <div>
      <button onClick={() => void handleContinue()}>Continue</button>
      <button onClick={handleConfirmMatch}>Confirm Match</button>
      <button onClick={() => void handleSkipToMatchDay()}>Skip</button>
      <div data-testid="show-match-confirm">{String(showMatchConfirm)}</div>
      <div data-testid="blocker-count">
        {blockerModal?.blockers.length ?? 0}
      </div>
      <div data-testid="blocker-text">
        {blockerModal?.blockers.map((blocker) => blocker.text).join("|") ?? ""}
      </div>
      <div data-testid="can-continue-anyway">
        {String(blockerModal?.pendingAction !== undefined)}
      </div>
      <div data-testid="match-played-notice">{matchPlayedNotice ?? ""}</div>
      <div data-testid="auto-delegation-notice">{autoDelegationNotice ?? ""}</div>
    </div>
  );
}

describe("useAdvanceTime", function (): void {
  beforeEach(function resetMocks(): void {
    mockedInvoke.mockReset();
    mockedDelegateScrimDecision.mockReset();
    navigateMock.mockReset();
  });

  it("shows match confirmation before advancing on match day", async function (): Promise<void> {
    render(<HookHarness hasMatchToday defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("show-match-confirm")).toHaveTextContent(
        "true",
      );
    });

    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("navigates to the live match with snapshot and fixture state after confirmation", async function (): Promise<void> {
    const snapshot = {
      phase: "PreKickOff",
      current_minute: 0,
      home_score: 0,
      away_score: 0,
      possession: "Home",
      ball_zone: "Midfield",
    };

    mockedInvoke.mockResolvedValueOnce({
      action: "live_match",
      fixture_index: 7,
      mode: "live",
      snapshot,
    });

    render(<HookHarness hasMatchToday defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Match" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenCalledWith("advance_time_with_mode", {
        mode: "live",
      });
    });

    expect(navigateMock).toHaveBeenCalledWith("/match", {
      state: {
        fixtureIndex: 7,
        mode: "live",
        snapshot,
      },
    });
  });

  it("checks blocking actions before a normal continue and stops when blockers exist", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([
      {
        id: "urgent_messages",
        severity: "info",
        tab: "Inbox",
        text: "1 urgent unread message(s)",
      },
    ]);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="spectator" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenCalledWith("check_blocking_actions", { mode: "spectator" });
    });

    expect(screen.getByTestId("blocker-count")).toHaveTextContent("1");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("advances time on a normal day when blocker checks return empty", async function (): Promise<void> {
    const advancedGame = {
      clock: {
        current_date: "2026-07-02",
        start_date: "2026-07-01",
      },
    } as GameStateData;

    mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
      action: "advanced",
      game: advancedGame,
    });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenNthCalledWith(1, "check_blocking_actions", { mode: "live" });
      expect(mockedInvoke).toHaveBeenNthCalledWith(
        2,
        "advance_time_with_mode",
        {
          mode: "live",
        },
      );
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("checks blocking actions before skipping to match day and stops when blockers exist", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([
      {
        id: "contract_expiry",
        severity: "warning",
        tab: "Finances",
        text: "A contract decision is still pending",
      },
    ]);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenCalledWith("check_blocking_actions", { mode: "live", includeScrimStops: false });
    });

    expect(screen.getByTestId("blocker-count")).toHaveTextContent("1");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("shows scrim decision blocker when backend returns blocked_scrim_decision", async function (): Promise<void> {
    mockedInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        action: "blocked_scrim_decision",
        game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
      });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenNthCalledWith(1, "check_blocking_actions", { mode: "live" });
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "advance_time_with_mode", {
        mode: "live",
      });
    });

    expect(screen.getByTestId("blocker-count")).toHaveTextContent("1");
  });

  it("shows scrim setup blocker when backend returns blocked_scrim_setup", async function (): Promise<void> {
    mockedInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        action: "blocked_scrim_setup",
        game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
      });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenNthCalledWith(1, "check_blocking_actions", { mode: "live" });
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "advance_time_with_mode", {
        mode: "live",
      });
    });

    expect(screen.getByTestId("blocker-count")).toHaveTextContent("1");
  });

  it("auto-delegates scrim decision and retries advance when mode is assistant", async function (): Promise<void> {
    mockedInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        action: "blocked_scrim_decision",
        game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
      })
      .mockResolvedValueOnce({
        action: "advanced",
        game: { clock: { current_date: "2026-07-03", start_date: "2026-07-01" } },
      });
    mockedDelegateScrimDecision.mockResolvedValue({
      clock: { current_date: "2026-07-02", start_date: "2026-07-01" },
    } as GameStateData);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" scrimReviewMode="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "advance_time_with_mode", { mode: "live" });
      expect(mockedDelegateScrimDecision).toHaveBeenCalledTimes(1);
      expect(mockedInvoke).toHaveBeenNthCalledWith(3, "advance_time_with_mode", { mode: "live" });
    });

    expect(screen.getByTestId("blocker-count")).toHaveTextContent("0");
    expect(screen.getByTestId("auto-delegation-notice")).toHaveTextContent("Assistant Coach resolved");
  });

  it("bypasses pre-check scrim blockers in assistant mode and auto-resolves on continue", async function (): Promise<void> {
    mockedInvoke
      .mockResolvedValueOnce([
        {
          id: "scrim_decision_required",
          severity: "warn",
          tab: "Scrims",
          text: "Make a scrim decision before continuing.",
        },
      ])
      .mockResolvedValueOnce({
        action: "blocked_scrim_decision",
        game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
      })
      .mockResolvedValueOnce({
        action: "advanced",
        game: { clock: { current_date: "2026-07-03", start_date: "2026-07-01" } },
      });
    mockedDelegateScrimDecision.mockResolvedValue({
      clock: { current_date: "2026-07-02", start_date: "2026-07-01" },
    } as GameStateData);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" scrimReviewMode="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenNthCalledWith(1, "check_blocking_actions", { mode: "live" });
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "advance_time_with_mode", { mode: "live" });
      expect(mockedDelegateScrimDecision).toHaveBeenCalledTimes(1);
      expect(mockedInvoke).toHaveBeenNthCalledWith(3, "advance_time_with_mode", { mode: "live" });
    });

    expect(screen.getByTestId("blocker-count")).toHaveTextContent("0");
    expect(screen.getByTestId("auto-delegation-notice")).toHaveTextContent("Assistant Coach resolved");
  });

  it("assistant continue resolves chained scrim blockers across days in one click", async function (): Promise<void> {
    const gameStateWithDate = (current_date: string) => ({
      clock: { current_date, start_date: "2026-07-01" },
      manager: { team_id: "lec-mad" },
      teams: [{ id: "lec-mad", scrim_weekly_slots: 4 }],
    });

    mockedInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        action: "blocked_scrim_decision",
        game: gameStateWithDate("2026-07-01"),
      })
      .mockResolvedValueOnce({
        action: "advanced",
        game: gameStateWithDate("2026-07-02"),
      })
      .mockResolvedValueOnce({
        action: "blocked_scrim_decision",
        game: gameStateWithDate("2026-07-02"),
      })
      .mockResolvedValueOnce({
        action: "advanced",
        game: gameStateWithDate("2026-07-03"),
      });

    mockedDelegateScrimDecision
      .mockResolvedValueOnce(gameStateWithDate("2026-07-01") as GameStateData)
      .mockResolvedValueOnce(gameStateWithDate("2026-07-02") as GameStateData);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" scrimReviewMode="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedDelegateScrimDecision).toHaveBeenCalledTimes(1);
      expect(mockedInvoke).toHaveBeenCalledWith("advance_time_with_mode", { mode: "live" });
    });

    expect(screen.getByTestId("blocker-count")).toHaveTextContent("0");
    expect(screen.getByTestId("auto-delegation-notice")).toHaveTextContent("Assistant Coach resolved");
  });

  it("assistant continue advances exactly one day when there are no scrims", async function (): Promise<void> {
    mockedInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        action: "advanced",
        game: { clock: { current_date: "2026-07-03", start_date: "2026-07-01" } },
      });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" scrimReviewMode="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenNthCalledWith(1, "check_blocking_actions", { mode: "live" });
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "advance_time_with_mode", { mode: "live" });
    });

    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(mockedDelegateScrimDecision).not.toHaveBeenCalled();
    expect(screen.getByTestId("blocker-count")).toHaveTextContent("0");
  });

  it("auto-delegates scrim decision and retries skip-to-match-day when blocked", async function (): Promise<void> {
    mockedInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        action: "blocked",
        game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
        blockers: [
          {
            id: "scrim_decision_required",
            severity: "warn",
            tab: "Scrims",
            text: "Make a scrim decision before continuing.",
          },
        ],
      })
      .mockResolvedValueOnce({
        action: "advanced",
        game: { clock: { current_date: "2026-07-06", start_date: "2026-07-01" } },
        days_skipped: 4,
      });
    mockedDelegateScrimDecision.mockResolvedValue({
      clock: { current_date: "2026-07-02", start_date: "2026-07-01" },
    } as GameStateData);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" scrimReviewMode="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenNthCalledWith(1, "check_blocking_actions", { mode: "live", includeScrimStops: false });
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "skip_to_match_day");
      expect(mockedDelegateScrimDecision).toHaveBeenCalledTimes(1);
      expect(mockedInvoke).toHaveBeenNthCalledWith(3, "skip_to_match_day");
    });

    expect(screen.getByTestId("blocker-count")).toHaveTextContent("0");
    expect(screen.getByTestId("auto-delegation-notice")).toHaveTextContent("Assistant Coach resolved");
  });

  it("tells the user the staff played their match when skipping to match day", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
      action: "arrived",
      days_skipped: 3,
      match_simulated: true,
      game: {
        clock: { current_date: "2026-07-05", start_date: "2026-07-01" },
        manager: { team_id: "t1" },
        teams: [{ id: "t1", name: "Mine" }, { id: "t2", name: "Rivals" }],
        leagues: [{
          fixtures: [{
            id: "f1", date: "2026-07-05", home_team_id: "t2", away_team_id: "t1",
            status: "Completed", result: { home_wins: 0, away_wins: 2 },
          }],
        }],
      },
    });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("match-played-notice")).toHaveTextContent("Rivals");
    });
    expect(screen.getByTestId("match-played-notice")).toHaveTextContent("2-0");
  });

  it("passes the delegate mode to the pre-check for an unemployed manager", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
      action: "advanced",
      game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
    });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" isUnemployed />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenNthCalledWith(1, "check_blocking_actions", {
        mode: "delegate",
      });
      expect(mockedInvoke).toHaveBeenNthCalledWith(2, "advance_time_with_mode", {
        mode: "delegate",
      });
    });
  });

  it("never offers Continue anyway for a scrim blocker the backend enforces", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([
      { id: "incomplete_lineup", severity: "warn", tab: "Squad", text: "Lineup" },
      { id: "scrim_setup_required", severity: "warn", tab: "Scrims", text: "raw" },
    ]);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("blocker-count")).toHaveTextContent("2");
    });
    expect(screen.getByTestId("can-continue-anyway")).toHaveTextContent("false");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("still offers Continue anyway for blockers the backend does not enforce", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([
      { id: "incomplete_lineup", severity: "warn", tab: "Squad", text: "Lineup" },
    ]);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("can-continue-anyway")).toHaveTextContent("true");
    });
  });

  it("words the scrim blockers through i18n with English defaults", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
      action: "blocked_scrim_decision",
      game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
    });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("blocker-text")).toHaveTextContent(
        "Make a scrim decision before continuing.",
      );
    });
    expect(screen.getByTestId("can-continue-anyway")).toHaveTextContent("false");
  });

  it("drops the scrim blockers in assistant mode so a mixed list can still continue", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([
      { id: "incomplete_lineup", severity: "warn", tab: "Squad", text: "Lineup" },
      { id: "scrim_setup_required", severity: "warn", tab: "Scrims", text: "raw" },
    ]);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" scrimReviewMode="assistant" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("blocker-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("can-continue-anyway")).toHaveTextContent("true");
  });
});
