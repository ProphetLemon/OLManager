import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { GameStateData, ScrimReportData, TeamData } from "@/store/gameStore";
import type { ScrimContextResponse } from "@/lib/scrims/scrimContext";
import ScrimsTab from "@/ui-v2/_legacy/components/scrims/ScrimsTab";

const chooseDailyScrimActionMock = vi.fn();
const useScrimContextWithFallbackMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (key === "scrims.reviewDecisionApplied") return "Decisión aplicada.";
      if (typeof fallback === "string") return fallback;
      if (fallback && typeof fallback === "object" && fallback.defaultValue) return fallback.defaultValue;
      return key;
    },
  }),
}));

vi.mock("@/services/trainingService", () => ({
  chooseDailyScrimAction: (...args: unknown[]) => chooseDailyScrimActionMock(...args),
  setWeeklyScrimObjective: vi.fn(),
  setWeeklyScrimSlots: vi.fn(),
}));

vi.mock("@/hooks/useScrimContextWithFallback", () => ({
  useScrimContextWithFallback: (...args: unknown[]) => useScrimContextWithFallbackMock(...args),
}));

function report(overrides: Partial<ScrimReportData> = {}): ScrimReportData {
  return {
    date: "2026-04-29",
    week_key: "2026-W18",
    slot_index: 1,
    weekday: 2,
    team_id: "mine",
    opponent_team_id: "rival",
    status: "Played",
    won: false,
    focus: "DraftPrep",
    issue: "ObjectiveSetup",
    severity: 2,
    quality: 68,
    player_champion_picks: [],
    post_decision: null,
    created_on: "2026-04-29",
    ...overrides,
  };
}

function team(overrides: Partial<TeamData> & Pick<TeamData, "id" | "name">): TeamData {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    short_name: name.slice(0, 3).toUpperCase(),
    country: "ES",
    city: "Madrid",
    stadium_name: "Arena",
    stadium_capacity: 10000,
    finance: 0,
    manager_id: null,
    reputation: 500,
    wage_budget: 0,
    transfer_budget: 0,
    season_income: 0,
    season_expenses: 0,
    draft_strategy: "Balanced",
    training_focus: "Scrims",
    training_intensity: "Medium",
    training_schedule: "Balanced",
    founded_year: 2024,
    colors: { primary: "#000", secondary: "#fff" },
    starting_xi_ids: [],
    form: [],
    history: [],
    ...rest,
  };
}

function gameState(): GameStateData {
  return {
    manager: { team_id: "mine" },
    teams: [
      team({ id: "mine", name: "Mine", scrim_weekly_slots: 2, weekly_scrim_plan_team_ids: [["rival"], ["rival"]] }),
      team({ id: "rival", name: "Rival" }),
    ],
    players: [],
    clock: { current_date: "2026-04-29" },
    day_phase: "ScrimBlock",
  } as unknown as GameStateData;
}

function gameStateWithPhase(dayPhase: GameStateData["day_phase"]): GameStateData {
  return {
    ...gameState(),
    day_phase: dayPhase,
  } as GameStateData;
}

function makeContext(): ScrimContextResponse {
  return {
    today: {
      state: "PlayedNeedsReview",
      slotIndex: 1,
      opponentTeamId: "rival",
      resolvedOpponentTeamId: "rival",
      objective: "DraftPrep",
      report: report(),
      canEditPlan: false,
      canCancel: false,
      canReview: true,
      canViewWeeklyPlan: true,
      hasOfficialMatch: false,
      primaryAction: "Review",
      pushThroughRecommended: false,
    },
    week: {
      weekKey: "2026-W18",
      objective: "DraftPrep",
      capacity: 2,
      planned: 2,
      reputation: 50,
      cancellations: 0,
      played: 1,
      wins: 0,
      losses: 1,
      lossStreak: 1,
      avgQuality: 68,
      topFocus: "DraftPrep",
      topIssue: "ObjectiveSetup",
      nextOfficialRivalTeamId: null,
      nextOfficialRivalCompetition: null,
      setupLocked: false,
      setupLockedReason: null,
      canFinalizeSetup: true,
      slots: [],
      latestReports: [report()],
    },
  };
}

function makeContextWithSlot(slotIndex: number): ScrimContextResponse {
  const base = makeContext();
  return {
    ...base,
    today: {
      ...base.today,
      slotIndex,
      report: report({ slot_index: slotIndex }),
    },
    week: {
      ...base.week,
      latestReports: [report({ slot_index: slotIndex })],
    },
  };
}

describe("ScrimsTab interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScrimContextWithFallbackMock.mockReturnValue(makeContext());
  });

  it("applies manual review decision from Today Block", async () => {
    chooseDailyScrimActionMock.mockResolvedValue(gameState());
    const onGameUpdate = vi.fn();

    render(<ScrimsTab gameState={gameStateWithPhase("ScrimBlock")} onGameUpdate={onGameUpdate} />);

    fireEvent.click(screen.getByText("VOD Review"));

    await waitFor(() => {
      expect(chooseDailyScrimActionMock).toHaveBeenCalledWith(1, "VodReview");
      expect(onGameUpdate).toHaveBeenCalled();
      expect(screen.getByText(/Decisión aplicada\./i)).toBeInTheDocument();
    });
  });

  it("keeps review flow active when a second same-day block is still pending", async () => {
    chooseDailyScrimActionMock.mockResolvedValue(gameState());
    const onGameUpdate = vi.fn();

    useScrimContextWithFallbackMock
      .mockReturnValueOnce(makeContextWithSlot(1))
      .mockReturnValue(makeContextWithSlot(0));

    const { rerender } = render(<ScrimsTab gameState={gameStateWithPhase("ScrimBlock")} onGameUpdate={onGameUpdate} />);

    fireEvent.click(screen.getByText("VOD Review"));

    await waitFor(() => {
      expect(chooseDailyScrimActionMock).toHaveBeenCalledWith(1, "VodReview");
    });

    rerender(<ScrimsTab gameState={gameStateWithPhase("ScrimBlock")} onGameUpdate={onGameUpdate} />);

    await waitFor(() => {
      expect(screen.getByText("Push Through")).toBeInTheDocument();
    });
  });

  it("shows review decision buttons in ScrimBlock, where the backend blocks on the pending review", () => {
    render(<ScrimsTab gameState={gameState()} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("VOD Review")).toBeInTheDocument();
  });

  it("hides review decision buttons in the morning, before the scrims are played", () => {
    render(<ScrimsTab gameState={gameStateWithPhase("Morning")} onGameUpdate={vi.fn()} />);

    expect(screen.queryByText("VOD Review")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delegar al Assistant Coach" })).not.toBeInTheDocument();
  });

  it("requires CancelScrims before showing recovery techniques on bad first block", async () => {
    chooseDailyScrimActionMock.mockResolvedValue(gameState());
    const onGameUpdate = vi.fn();
    useScrimContextWithFallbackMock.mockReturnValue(makeContextWithSlot(0));

    render(<ScrimsTab gameState={gameStateWithPhase("ScrimBlock")} onGameUpdate={onGameUpdate} />);

    expect(screen.getByText("Push Through")).toBeInTheDocument();
    expect(screen.getByText("Cancel scrims")).toBeInTheDocument();
    expect(screen.queryByText("VOD Review")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel scrims"));

    await waitFor(() => {
      expect(chooseDailyScrimActionMock).not.toHaveBeenCalled();
      expect(screen.getByText("VOD Review")).toBeInTheDocument();
      expect(screen.getByText("Mental Reset")).toBeInTheDocument();
      expect(screen.getByText("Targeted Drills")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("VOD Review"));

    await waitFor(() => {
      expect(chooseDailyScrimActionMock).toHaveBeenCalledWith(0, "VodReview");
      expect(onGameUpdate).toHaveBeenCalled();
    });
  });

  it("shows continue/rest decisions after winning the first block even with low quality", () => {
    const firstBlockWinContext = makeContextWithSlot(0);
    useScrimContextWithFallbackMock.mockReturnValue({
      ...firstBlockWinContext,
      today: {
        ...firstBlockWinContext.today,
        report: report({ slot_index: 0, won: true, quality: 43, severity: 4 }),
      },
      week: {
        ...firstBlockWinContext.week,
        latestReports: [report({ slot_index: 0, won: true, quality: 43, severity: 4 })],
      },
    });

    render(<ScrimsTab gameState={gameStateWithPhase("ScrimBlock")} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("Continue to block 2")).toBeInTheDocument();
    expect(screen.getByText("Offer rest")).toBeInTheDocument();
    expect(screen.queryByText("Push Through")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel scrims")).not.toBeInTheDocument();
  });
});
