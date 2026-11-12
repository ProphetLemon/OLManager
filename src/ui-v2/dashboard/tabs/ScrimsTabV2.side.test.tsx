import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScrimContextResponse } from "@/lib/scrims/scrimContext";
import { buildStaffSuggestions } from "@/lib/scrims/scrimContext";
import type { GameStateData, TeamData } from "@/store/gameStore";
import { ScrimsTabV2 } from "@/ui-v2/dashboard/tabs/ScrimsTabV2";

const useScrimContextWithFallbackMock = vi.fn();

// Every text reads back as its key, so a staff suggestion is recognised by the key `buildStaffSuggestions` gave it.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/services/trainingService", () => ({
  chooseDailyScrimAction: vi.fn(),
  finalizeWeeklyScrimSetup: vi.fn(),
  getScrimContext: vi.fn(),
  setWeeklyScrimObjective: vi.fn(),
  setWeeklyScrimPlans: vi.fn(),
  setWeeklyScrimSlots: vi.fn(),
}));

vi.mock("@/hooks/useScrimContextWithFallback", () => ({
  useScrimContextWithFallback: (...args: unknown[]) => useScrimContextWithFallbackMock(...args),
}));

function team(id: string, name: string, extra: Partial<TeamData> = {}): TeamData {
  return {
    id,
    name,
    short_name: name.slice(0, 3),
    competition_id: "league",
    scrim_reputation: 50,
    starting_xi_ids: [],
    form: [],
    history: [],
    ...extra,
  } as unknown as TeamData;
}

const GAME = {
  manager: { team_id: "mine" },
  teams: [
    team("mine", "Kestrel Vale", { scrim_weekly_slots: 2, scrim_reputation: 38 }),
    team("northglass", "Northglass", { scrim_reputation: 44 }),
    team("ember", "Ember Five", { scrim_reputation: 35 }),
  ],
  players: [],
  clock: { current_date: "2026-03-09" },
  day_phase: "Morning",
} as unknown as GameStateData;

function setupContext(week: Partial<ScrimContextResponse["week"]> = {}): ScrimContextResponse {
  return {
    today: {
      state: "NoScrimToday",
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
      weekKey: "2026-W11",
      objective: null,
      capacity: 2,
      planned: 0,
      reputation: 38,
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
      slots: [0, 1].map((index) => ({
        slotIndex: index,
        weekday: 2,
        label: "",
        labelDay: 2,
        labelSuffix: index === 0 ? "A" : "B",
        plan: [],
        resolvedOpponentTeamId: null,
        resultWon: null,
        report: null,
        status: "Open",
        canEdit: true,
      })),
      latestReports: [],
      ...week,
    },
  } as unknown as ScrimContextResponse;
}

function suggestionList() {
  const section = document.querySelector("[data-slot='scrim-staff-suggestions']") as HTMLElement;
  return within(section)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("staff suggestions", () => {
  it("are the sentences buildStaffSuggestions gives, in its order and up to its three", () => {
    const week = setupContext({ objective: "Macro", lossStreak: 3, cancellations: 2 }).week;
    useScrimContextWithFallbackMock.mockReturnValue({ ...setupContext(), week });
    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    const noRivalsPlanned = {
      ownOvr: 74,
      plannedCount: 0,
      fallbackSlotCount: 0,
      avgOpponentOvr: 0,
      maxOpponentOvr: 0,
      avgOpponentScrimReputation: 0,
    };
    const expected = buildStaffSuggestions((key) => key, "Macro", 2, [], 3, 2, noRivalsPlanned, 38);
    expect(expected).toEqual([
      "training.scrims.staff.mentalReset",
      "training.scrims.staff.reduceCancellations",
      "training.scrims.staff.noPlannedOpponents",
    ]);
    expect(suggestionList()).toEqual(expected);
  });

  it("ask for an objective first when the week has none, and not for the plan to be kept", () => {
    useScrimContextWithFallbackMock.mockReturnValue(setupContext());
    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    const list = suggestionList();
    expect(list).toContain("training.scrims.staff.pickObjective");
    expect(list).not.toContain("training.scrims.staff.keepPlan");
  });
});

describe("rivals", () => {
  it("lists the clubs of the competition with the odds, and words the acceptance rule", () => {
    useScrimContextWithFallbackMock.mockReturnValue(setupContext());
    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    const table = screen.getByRole("table", { name: "scrims.rivalsTable" });
    const rows = within(table).getAllByRole("row");
    // Header, then Northglass and Ember Five at the same OVR, by name.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Ember Five", "74", "35", "50%", "54%"]);
    expect(within(rows[2]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Northglass", "74", "44", "50%", "48%"]);
    expect(screen.getByText("scrims.rivalsNote")).toBeInTheDocument();
  });

  it("stay on the setup day only", () => {
    useScrimContextWithFallbackMock.mockReturnValue(setupContext({ setupLocked: true, setupLockedReason: "week_started" }));
    const locked = setupContext({ setupLocked: true, setupLockedReason: "week_started" });
    useScrimContextWithFallbackMock.mockReturnValue({
      ...locked,
      today: { ...locked.today, state: "Planned", slotIndex: 0, opponentTeamId: "northglass" },
    });
    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    expect(screen.queryByRole("table", { name: "scrims.rivalsTable" })).toBeNull();
  });
});

describe("the reputation gauge", () => {
  it("draws its empty track with the --dim border so the track is visible against the card", () => {
    useScrimContextWithFallbackMock.mockReturnValue(setupContext());
    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    const gauge = screen.getByRole("meter", { name: "scrims.reputation" });
    expect(gauge).toHaveClass("border-dim");
    expect(gauge).toHaveAttribute("aria-valuenow", "38");
  });

  it("fills in proportion to the reputation, not to a tenth of it", () => {
    useScrimContextWithFallbackMock.mockReturnValue(setupContext({ reputation: 38 }));
    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    const fill = screen.getByRole("meter", { name: "scrims.reputation" }).firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("38%");
  });
});
