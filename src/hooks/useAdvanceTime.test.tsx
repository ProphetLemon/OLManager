import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { useGameStore, type GameStateData } from "../store/gameStore";
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
  seasonOver?: boolean;
  onGameState?: (state: GameStateData) => void;
}): JSX.Element {
  const [, setGameState] = useState<GameStateData | null>(null);
  const {
    blockerModal,
    autoDelegationNotice,
    matchPlayedNotice,
    scrimResultNotice,
    handleConfirmMatch,
    handleContinue,
    handleSkipToMatchDay,
    handleSkipToNextDay,
    showMatchConfirm,
  } =
    useAdvanceTime(
      (state) => {
        setGameState(state);
        props.onGameState?.(state);
      },
      props.hasMatchToday,
      props.defaultMatchMode,
      props.scrimReviewMode ?? "manual",
      true,
      props.isUnemployed ?? false,
      props.seasonOver ?? false,
    );

  return (
    <div>
      <button onClick={() => void handleContinue()}>Continue</button>
      <button onClick={handleConfirmMatch}>Confirm Match</button>
      <button onClick={() => void handleSkipToMatchDay()}>Skip</button>
      <button onClick={() => void handleSkipToNextDay()}>Skip day</button>
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
      <div data-testid="scrim-result-notice">{scrimResultNotice?.join(" | ") ?? ""}</div>
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

  it("calls no advance command from any entry point while the split is over", async function (): Promise<void> {
    render(<HookHarness hasMatchToday defaultMatchMode="live" seasonOver />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip day" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Match" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("show-match-confirm")).toHaveTextContent("false");
    });
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId("blocker-count")).toHaveTextContent("0");
  });

  it("treats the backend season_complete answer as a no-op when skipping a day", async function (): Promise<void> {
    const onGameState = vi.fn();
    mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
      action: "season_complete",
      game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
    });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" onGameState={onGameState} />);

    fireEvent.click(screen.getByRole("button", { name: "Skip day" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "advance_time_with_mode", { mode: "live" });
    expect(onGameState).not.toHaveBeenCalled();
    expect(screen.getByTestId("blocker-count")).toHaveTextContent("0");
  });

  it("treats the backend season_complete answer as a no-op in the assistant continue loop", async function (): Promise<void> {
    const onGameState = vi.fn();
    mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
      action: "season_complete",
      game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
    });

    render(
      <HookHarness
        hasMatchToday={false}
        defaultMatchMode="live"
        scrimReviewMode="assistant"
        onGameState={onGameState}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });
    expect(onGameState).not.toHaveBeenCalled();
    expect(screen.getByTestId("blocker-count")).toHaveTextContent("0");
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
    // skip_to_match_day enforces every blocker, so Continue anyway would loop back here.
    expect(screen.getByTestId("can-continue-anyway")).toHaveTextContent("false");
  });

  it("does not offer Continue anyway when skip_to_match_day itself answers blocked", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
      action: "blocked",
      days_skipped: 2,
      blockers: [{ id: "incomplete_lineup", severity: "warn", tab: "Squad", text: "Lineup" }],
    });

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("blocker-count")).toHaveTextContent("1");
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "skip_to_match_day");
    expect(screen.getByTestId("can-continue-anyway")).toHaveTextContent("false");
  });

  it("still offers Continue anyway when skipping a day over a blocker the backend lets through", async function (): Promise<void> {
    mockedInvoke.mockResolvedValueOnce([
      { id: "incomplete_lineup", severity: "warn", tab: "Squad", text: "Lineup" },
    ]);

    render(<HookHarness hasMatchToday={false} defaultMatchMode="live" />);

    fireEvent.click(screen.getByRole("button", { name: "Skip day" }));

    await waitFor(function (): void {
      expect(screen.getByTestId("can-continue-anyway")).toHaveTextContent("true");
    });
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

  it("ends the day with a single advance when the backend answers that the day was processed", async function (): Promise<void> {
    const seen: string[] = [];
    mockedInvoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        action: "advanced",
        game: { clock: { current_date: "2026-07-02", start_date: "2026-07-01" } },
      })
      .mockResolvedValueOnce({
        action: "advanced",
        game: { clock: { current_date: "2026-07-03", start_date: "2026-07-01" } },
      });

    render(
      <HookHarness
        hasMatchToday={false}
        defaultMatchMode="live"
        onGameState={(state) => seen.push(String(state.clock.current_date))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(function (): void {
      expect(seen).toContain("2026-07-02");
    });
    const advances = mockedInvoke.mock.calls.filter((call) => call[0] === "advance_time_with_mode");
    expect(advances).toHaveLength(1);
    expect(seen).not.toContain("2026-07-03");
  });

  it("skipping to the next day stops at the advance that ended the day", async function (): Promise<void> {
    const seen: string[] = [];
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command !== "advance_time_with_mode") return [];
      const advances = mockedInvoke.mock.calls.filter((call) => call[0] === "advance_time_with_mode").length;
      return {
        action: "advanced",
        game: { clock: { current_date: advances === 1 ? "2026-07-02" : "2026-07-03", start_date: "2026-07-01" } },
      };
    });

    render(
      <HookHarness
        hasMatchToday={false}
        defaultMatchMode="live"
        onGameState={(state) => seen.push(String(state.clock.current_date))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip day" }));

    await waitFor(function (): void {
      expect(seen).toContain("2026-07-02");
    });
    const advances = mockedInvoke.mock.calls.filter((call) => call[0] === "advance_time_with_mode");
    expect(advances).toHaveLength(1);
    expect(seen).not.toContain("2026-07-03");
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

  describe("scrim result notice", function (): void {
    type Report = { week_key: string; slot_index: number; opponent_team_id: string; won: boolean | null };

    function gameWithReports(reports: Report[]): GameStateData {
      return {
        clock: { current_date: "2026-07-01", start_date: "2026-07-01" },
        manager: { team_id: "t1" },
        teams: [
          { id: "t1", name: "Mine", scrim_weekly_slots: 2, scrim_reports: reports },
          { id: "t2", name: "Rivals" },
          { id: "t3", name: "Others" },
        ],
      } as unknown as GameStateData;
    }

    const wonAgainstT2: Report = { week_key: "2026-W27", slot_index: 0, opponent_team_id: "t2", won: true };
    const lostAgainstT3: Report = { week_key: "2026-W27", slot_index: 1, opponent_team_id: "t3", won: false };

    function advanceInto(game: GameStateData, scrimReviewMode: "manual" | "assistant" = "manual"): void {
      useGameStore.setState({ gameState: gameWithReports([]) });
      mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({ action: "advanced", game });
      render(
        <HookHarness
          hasMatchToday={false}
          defaultMatchMode="live"
          scrimReviewMode={scrimReviewMode}
          onGameState={(state) => useGameStore.getState().setGameState(state)}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    }

    afterEach(function (): void {
      useGameStore.setState({ gameState: null });
    });

    it("names the rival and the win when an advance resolves a won scrim", async function (): Promise<void> {
      advanceInto(gameWithReports([wonAgainstT2]));

      await waitFor(function (): void {
        expect(screen.getByTestId("scrim-result-notice")).toHaveTextContent("Won against Rivals");
      });
    });

    it("names the rival and the loss when an advance resolves a lost scrim", async function (): Promise<void> {
      advanceInto(gameWithReports([lostAgainstT3]));

      await waitFor(function (): void {
        expect(screen.getByTestId("scrim-result-notice")).toHaveTextContent("Lost against Others");
      });
    });

    it("lists both scrims in one notice when two resolve in one advance", async function (): Promise<void> {
      advanceInto(gameWithReports([wonAgainstT2, lostAgainstT3]));

      await waitFor(function (): void {
        expect(screen.getByTestId("scrim-result-notice")).toHaveTextContent(
          "Won against Rivals | Lost against Others",
        );
      });
    });

    it("sets no notice when the advance brings no new scrim report", async function (): Promise<void> {
      useGameStore.setState({ gameState: gameWithReports([wonAgainstT2]) });
      mockedInvoke.mockResolvedValueOnce([]).mockResolvedValueOnce({
        action: "advanced",
        game: gameWithReports([wonAgainstT2]),
      });
      const onGameState = vi.fn((state: GameStateData) => useGameStore.getState().setGameState(state));
      render(<HookHarness hasMatchToday={false} defaultMatchMode="live" onGameState={onGameState} />);

      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(function (): void {
        expect(onGameState).toHaveBeenCalled();
      });
      expect(screen.getByTestId("scrim-result-notice")).toHaveTextContent("");
    });

    it("also announces the result when the Assistant Coach is handling the scrims", async function (): Promise<void> {
      advanceInto(gameWithReports([wonAgainstT2]), "assistant");

      await waitFor(function (): void {
        expect(screen.getByTestId("scrim-result-notice")).toHaveTextContent("Won against Rivals");
      });
    });
  });
});
