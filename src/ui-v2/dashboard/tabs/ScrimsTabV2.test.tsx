import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { GameStateData, ScrimReportData, TeamData } from "@/store/gameStore";
import type { ScrimContextResponse } from "@/lib/scrims/scrimContext";
import { ScrimsTabV2 } from "@/ui-v2/dashboard/tabs/ScrimsTabV2";

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
  getScrimContext: vi.fn(),
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

describe("ScrimsTabV2 pending review decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScrimContextWithFallbackMock.mockReturnValue(makeContext());
  });

  it("shows the decision buttons in ScrimBlock with an unresolved report", async () => {
    chooseDailyScrimActionMock.mockResolvedValue(gameState());
    const onGameUpdate = vi.fn();

    render(<ScrimsTabV2 gameState={gameStateWithPhase("ScrimBlock")} onGameUpdate={onGameUpdate} />);

    fireEvent.click(screen.getByText("scrims.decision.vodReview"));

    await waitFor(() => {
      expect(chooseDailyScrimActionMock).toHaveBeenCalledWith(1, "VodReview");
    });
  });

  it("keeps showing the decision buttons in ReviewBlock", () => {
    render(<ScrimsTabV2 gameState={gameStateWithPhase("ReviewBlock")} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("scrims.decision.vodReview")).toBeInTheDocument();
  });

  it("hides the decision buttons when the backend does not allow a review", () => {
    const context = makeContext();
    useScrimContextWithFallbackMock.mockReturnValue({
      ...context,
      today: { ...context.today, canReview: false, primaryAction: "Training" },
    });

    render(<ScrimsTabV2 gameState={gameStateWithPhase("Morning")} onGameUpdate={vi.fn()} />);

    expect(screen.queryByText("scrims.decision.vodReview")).not.toBeInTheDocument();
  });
});
