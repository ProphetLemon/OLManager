import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { ScrimContextResponse } from "@/lib/scrims/scrimContext";
import type { GameStateData, TeamData } from "@/store/gameStore";
import { ScrimsTabV2 } from "@/ui-v2/dashboard/tabs/ScrimsTabV2";

const useScrimContextWithFallbackMock = vi.fn();

vi.mock("@/services/trainingService", () => ({
  chooseDailyScrimAction: vi.fn(),
  getScrimContext: vi.fn(),
  setWeeklyScrimObjective: vi.fn(),
  setWeeklyScrimSlots: vi.fn(),
}));

vi.mock("@/hooks/useScrimContextWithFallback", () => ({
  useScrimContextWithFallback: (...args: unknown[]) => useScrimContextWithFallbackMock(...args),
}));

function gameOn(currentDate: string): GameStateData {
  return {
    manager: { team_id: "mine" },
    teams: [
      {
        id: "mine",
        name: "Mine",
        short_name: "MIN",
        country: "ES",
        colors: { primary: "#000", secondary: "#fff" },
        starting_xi_ids: [],
        form: [],
        history: [],
        scrim_weekly_slots: 4,
      } as unknown as TeamData,
    ],
    players: [],
    clock: { current_date: currentDate, start_date: "2027-01-01T12:00:00Z" },
    day_phase: "Morning",
  } as unknown as GameStateData;
}

function slot(index: number, canEdit: boolean) {
  return {
    slotIndex: index,
    weekday: 2 + Math.floor(index / 2),
    label: "Wed",
    labelDay: 2,
    labelSuffix: "",
    plan: [],
    resolvedOpponentTeamId: null,
    resultWon: null,
    report: null,
    status: (canEdit ? "Open" : "Locked") as "Open" | "Locked",
    canEdit,
  };
}

function lockedContext(reason: string, canEdit = false): ScrimContextResponse {
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
      weekKey: "2026-W53",
      objective: null,
      capacity: 4,
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
      setupLocked: true,
      setupLockedReason: reason,
      canFinalizeSetup: false,
      slots: [slot(0, canEdit), slot(1, canEdit), slot(2, canEdit), slot(3, canEdit)],
      latestReports: [],
    },
  } as unknown as ScrimContextResponse;
}

describe("ScrimsTabV2 first-week text of a new career", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("says in English that the career started after the scrim days and names Monday 4 January", async () => {
    await i18n.changeLanguage("en");
    useScrimContextWithFallbackMock.mockReturnValue(lockedContext("career_started_late"));

    render(<ScrimsTabV2 gameState={gameOn("2027-01-01")} onGameUpdate={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Your career starts after this week's scrim days. Planning opens on Monday, January 4.",
    );
    expect(screen.queryByText(/first scrim day has already started/)).toBeNull();
  });

  it("says it in Spanish with the Monday written in Spanish", async () => {
    await i18n.changeLanguage("es");
    useScrimContextWithFallbackMock.mockReturnValue(lockedContext("career_started_late"));

    render(<ScrimsTabV2 gameState={gameOn("2027-01-01")} onGameUpdate={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Tu carrera empieza después de los días de scrim de esta semana. La planificación se abre el lunes, 4 de enero.",
    );
  });

  it("names the same Monday on the Sunday of that first week", async () => {
    await i18n.changeLanguage("en");
    useScrimContextWithFallbackMock.mockReturnValue(lockedContext("career_started_late"));

    render(<ScrimsTabV2 gameState={gameOn("2027-01-03")} onGameUpdate={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Planning opens on Monday, January 4.");
  });

  it("keeps the regular first-window text in a later week with the same lock", async () => {
    await i18n.changeLanguage("en");
    useScrimContextWithFallbackMock.mockReturnValue(lockedContext("first_scrim_window"));

    render(<ScrimsTabV2 gameState={gameOn("2027-01-14")} onGameUpdate={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "This week's first scrim day has already started, so the setup is locked. It reopens next Monday.",
    );
    expect(screen.queryByText(/Your career starts/)).toBeNull();
  });

  it("keeps the regular first-window text for a Friday start with Friday scrim slots still open", async () => {
    await i18n.changeLanguage("en");
    // Intense schedule: the backend keeps `first_scrim_window` because Friday slots are still ahead.
    useScrimContextWithFallbackMock.mockReturnValue(lockedContext("first_scrim_window", true));

    render(<ScrimsTabV2 gameState={gameOn("2027-01-01")} onGameUpdate={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("first scrim day has already started");
    expect(screen.queryByText(/Your career starts/)).toBeNull();
  });
});
