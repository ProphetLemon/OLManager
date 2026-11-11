import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScrimContextResponse } from "@/lib/scrims/scrimContext";
import type { GameStateData, TeamData } from "@/store/gameStore";
import { ScrimsTabV2 } from "@/ui-v2/dashboard/tabs/ScrimsTabV2";

const useScrimContextWithFallbackMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (typeof fallback === "string") return fallback;
      if (fallback && typeof fallback === "object" && fallback.defaultValue) return fallback.defaultValue;
      return key;
    },
  }),
}));

vi.mock("@/services/trainingService", () => ({
  chooseDailyScrimAction: vi.fn(),
  getScrimContext: vi.fn(),
  setWeeklyScrimObjective: vi.fn(),
  setWeeklyScrimSlots: vi.fn(),
}));

vi.mock("@/hooks/useScrimContextWithFallback", () => ({
  useScrimContextWithFallback: (...args: unknown[]) => useScrimContextWithFallbackMock(...args),
}));

function team(id: string, name: string, extra: Partial<TeamData> = {}): TeamData {
  return {
    id,
    name,
    short_name: name.slice(0, 3).toUpperCase(),
    country: "ES",
    colors: { primary: "#000", secondary: "#fff" },
    starting_xi_ids: [],
    form: [],
    history: [],
    ...extra,
  } as unknown as TeamData;
}

const GAME = {
  manager: { team_id: "mine" },
  teams: [team("mine", "Mine", { scrim_weekly_slots: 2 }), team("rival", "Rival")],
  players: [],
  clock: { current_date: "2026-04-24" },
  day_phase: "Morning",
} as unknown as GameStateData;

function slot(index: number, canEdit: boolean) {
  return {
    slotIndex: index,
    weekday: index * 2,
    label: "Mon",
    labelDay: index * 2,
    labelSuffix: "",
    plan: [],
    resolvedOpponentTeamId: null,
    resultWon: null,
    report: null,
    status: (canEdit ? "Open" : "Locked") as "Open" | "Locked",
    canEdit,
  };
}

function context(week: Partial<ScrimContextResponse["week"]>): ScrimContextResponse {
  return {
    today: {
      state: "Idle",
      slotIndex: null,
      opponentTeamId: null,
      resolvedOpponentTeamId: null,
      objective: null,
      report: null,
      canEditPlan: false,
      canCancel: false,
      canReview: false,
      canViewWeeklyPlan: true,
      hasOfficialMatch: false,
      primaryAction: "Training",
      pushThroughRecommended: false,
    },
    week: {
      weekKey: "2026-W17",
      objective: null,
      capacity: 2,
      planned: 0,
      reputation: 50,
      cancellations: 0,
      played: 0,
      wins: 0,
      losses: 0,
      lossStreak: 0,
      avgQuality: 0,
      topFocus: null,
      topIssue: null,
      nextOfficialRivalTeamId: null,
      nextOfficialRivalCompetition: null,
      setupLocked: false,
      setupLockedReason: null,
      canFinalizeSetup: true,
      slots: [slot(0, true), slot(1, true)],
      latestReports: [],
      ...week,
    },
  } as unknown as ScrimContextResponse;
}

describe("ScrimsTabV2 says why the weekly setup is disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["manual", "scrims.setupLockedManual"],
    ["week_started", "scrims.setupLockedWeekStarted"],
    ["first_scrim_window", "scrims.setupLockedFirstWindow"],
  ])("explains the %s lock next to the form", (reason, key) => {
    useScrimContextWithFallbackMock.mockReturnValue(
      context({ setupLocked: true, setupLockedReason: reason, slots: [slot(0, false), slot(1, false)] }),
    );

    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    expect(screen.getAllByText(key).length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent(key);
  });

  it("explains a week whose scrim days have all passed even when no lock is set", () => {
    useScrimContextWithFallbackMock.mockReturnValue(context({ slots: [slot(0, false), slot(1, false)] }));

    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("scrims.setupAllSlotsPassed");
    expect(screen.queryByText("scrims.setupUnlockWindow")).toBeNull();
  });

  it("shows no lock notice while the setup is open", () => {
    useScrimContextWithFallbackMock.mockReturnValue(context({}));

    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("scrims.setupUnlockWindow")).toBeInTheDocument();
  });
});
