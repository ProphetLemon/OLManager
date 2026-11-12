import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ScrimContextResponse,
  TodayScrimContext,
  WeeklyScrimContext,
  WeeklyScrimSlotContext,
} from "@/lib/scrims/scrimContext";
import { useSettingsStore } from "@/store/settingsStore";
import type { GameStateData, ScrimReportData, TeamData } from "@/store/gameStore";
import { ScrimsTabV2 } from "@/ui-v2/dashboard/tabs/ScrimsTabV2";

const useScrimContextWithFallbackMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (typeof fallback === "string") return fallback;
      if (fallback && typeof fallback === "object" && fallback.defaultValue) return fallback.defaultValue;
      return key;
    },
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
  return { id, name, short_name: name.slice(0, 3), starting_xi_ids: [], form: [], history: [], ...extra } as unknown as TeamData;
}

const GAME = {
  manager: { team_id: "mine" },
  teams: [
    team("mine", "Kestrel Vale", { scrim_weekly_slots: 4 }),
    team("northglass", "Northglass", { scrim_reputation: 44 }),
    team("ember", "Ember Five", { scrim_reputation: 35 }),
    team("falcon", "Falcon Ridge", { scrim_reputation: 33 }),
  ],
  players: [],
  clock: { current_date: "2026-03-11" },
  day_phase: "Morning",
} as unknown as GameStateData;

function report(overrides: Partial<ScrimReportData> = {}): ScrimReportData {
  return {
    date: "2026-03-11",
    week_key: "2026-W11",
    slot_index: 0,
    weekday: 2,
    team_id: "mine",
    opponent_team_id: "northglass",
    status: "Played",
    won: false,
    focus: "Macro",
    issue: "ObjectiveSetup",
    severity: 2,
    quality: 65,
    player_champion_picks: [],
    post_decision: null,
    created_on: "2026-03-11",
    ...overrides,
  };
}

function slot(index: number, overrides: Partial<WeeklyScrimSlotContext> = {}): WeeklyScrimSlotContext {
  const weekday = index < 2 ? 2 : 3;
  return {
    slotIndex: index,
    weekday,
    label: "",
    labelDay: weekday,
    labelSuffix: index % 2 === 0 ? "A" : "B",
    plan: [],
    resolvedOpponentTeamId: null,
    resultWon: null,
    report: null,
    status: "Open",
    canEdit: true,
    ...overrides,
  };
}

function week(slots: WeeklyScrimSlotContext[], overrides: Partial<WeeklyScrimContext> = {}): WeeklyScrimContext {
  return {
    weekKey: "2026-W11",
    objective: "Macro",
    capacity: slots.length,
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
    slots,
    latestReports: [],
    ...overrides,
  };
}

function today(overrides: Partial<TodayScrimContext> = {}): TodayScrimContext {
  return {
    state: "NoScrimToday",
    slotIndex: null,
    opponentTeamId: null,
    resolvedOpponentTeamId: null,
    objective: "Macro",
    report: null,
    canEditPlan: false,
    canCancel: false,
    canReview: false,
    canViewWeeklyPlan: true,
    hasOfficialMatch: false,
    primaryAction: "Training",
    pushThroughRecommended: false,
    ...overrides,
  };
}

function show(context: ScrimContextResponse) {
  useScrimContextWithFallbackMock.mockReturnValue(context);
  return render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);
}

const OPEN_WEEK = week([0, 1, 2, 3].map((index) => slot(index)));

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, scrim_review_mode: "manual" } });
});

describe("which body owns the wide column", () => {
  it("shows the weekly setup on a day with nothing to decide yet", () => {
    show({ today: today(), week: OPEN_WEEK });

    expect(screen.getByRole("heading", { level: 2, name: "scrims.weeklySetup" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "training.scrims.weeklyObjective" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "scrims.weeklyVolume" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    expect(screen.queryByText("scrims.decision.pushThrough")).not.toBeInTheDocument();
  });

  it("shows the block decision as the main panel on a post-scrim day", () => {
    const played = report();
    show({
      today: today({ state: "PlayedNeedsReview", slotIndex: 0, opponentTeamId: "northglass", resolvedOpponentTeamId: "northglass", report: played, canReview: true }),
      week: week(
        [
          slot(0, { status: "Played", resolvedOpponentTeamId: "northglass", plan: ["northglass"], resultWon: false, report: played, canEdit: false }),
          slot(1, { plan: ["ember"] }),
          slot(2, { plan: ["falcon"] }),
          slot(3),
        ],
        { setupLocked: true, setupLockedReason: "week_started" },
      ),
    });

    expect(screen.getByRole("heading", { level: 2, name: "scrims.blockDecisionTitle" })).toBeInTheDocument();
    expect(screen.getByText("scrims.decision.pushThrough")).toBeInTheDocument();
    expect(screen.getByText("scrims.decision.cancelScrims")).toBeInTheDocument();
    // The setup is not the wide column any more: it is one closed line under the decision.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scrims\.weeklySetup/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows today's block with the setup recap once the week is locked and nothing is left to decide", () => {
    show({
      today: today({ state: "Planned", slotIndex: 2, opponentTeamId: "falcon" }),
      week: week(
        [
          slot(0, { status: "Reviewed", resolvedOpponentTeamId: "northglass", resultWon: false, report: report({ post_decision: "PushThrough" }), canEdit: false }),
          slot(1, { status: "Reviewed", resolvedOpponentTeamId: "ember", resultWon: true, report: report({ slot_index: 1, won: true, post_decision: "DayOff" }), canEdit: false }),
          slot(2, { plan: ["falcon", "ember"] }),
          slot(3),
        ],
        { setupLocked: true, setupLockedReason: "week_started" },
      ),
    });

    expect(screen.getByRole("heading", { level: 2, name: "scrims.todayBlock" })).toBeInTheDocument();
    expect(screen.getByText("scrims.nothingToDecide")).toBeInTheDocument();
    // The recap is open and tells the lock once.
    expect(screen.getByRole("button", { name: /scrims\.weeklySetup/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("scrims.setupLockedWeekStarted");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});

describe("today's block with no rival", () => {
  it("says there is no rival planned instead of printing the sentence with an empty name", () => {
    show({
      today: today({ state: "Planned", slotIndex: 0 }),
      week: week([slot(0), slot(1, { plan: ["ember"] }), slot(2), slot(3)], { setupLocked: true, setupLockedReason: "week_started" }),
    });

    expect(screen.getByText("scrims.nothingToDecideNoRival")).toBeInTheDocument();
    expect(screen.queryByText("scrims.nothingToDecide")).not.toBeInTheDocument();
  });
});

describe("the week strip", () => {
  it("names the day, block, rival, quality, status and result of every slot, and keeps a slot cleared today Open", () => {
    const blockA = report({ post_decision: "TargetedDrills", quality: 75 });
    show({
      today: today({ state: "Reviewed", slotIndex: 0, report: blockA }),
      week: week(
        [
          slot(0, { status: "Reviewed", resolvedOpponentTeamId: "northglass", plan: ["northglass"], resultWon: false, report: blockA, canEdit: false }),
          slot(1),
          slot(2, { plan: ["falcon"] }),
          slot(3, { status: "Cancelled", canEdit: false }),
        ],
        { setupLocked: true, setupLockedReason: "week_started" },
      ),
    });

    const chips = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='scrim-slot-chip']"));
    expect(chips).toHaveLength(4);
    const [wedA, wedB, thuA, thuB] = chips;

    expect(wedA).toHaveTextContent("training.days.wed A");
    expect(wedA).toHaveTextContent("Northglass");
    expect(wedA).toHaveTextContent("Q75");
    expect(wedA).toHaveTextContent("scrims.slotStatus.reviewed");
    expect(wedA).toHaveTextContent("Loss");

    // The game keeps this slot Open until its weekday is past, and the confirmed week cannot be edited.
    expect(wedB).toHaveAttribute("data-status", "Locked");
    expect(wedB).toHaveTextContent("scrims.planCleared");
    expect(wedB).toHaveTextContent("scrims.slotStatus.locked");

    expect(thuA).toHaveTextContent("Falcon Ridge");
    expect(thuA).toHaveTextContent("scrims.slotStatus.locked");
    // A past slot that never had a plan was not played; nobody cancelled it.
    expect(thuB).toHaveTextContent("scrims.notPlanned");
    expect(thuB).toHaveTextContent("scrims.slotStatus.notPlayed");
    expect(thuB).not.toHaveTextContent("scrims.slotStatus.cancelled");
  });

  it("keeps an Open slot Open while the week's setup is not confirmed", () => {
    show({ today: today(), week: week([0, 1, 2, 3].map((index) => slot(index, { plan: index === 0 ? ["northglass"] : [] }))) });
    const [first] = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='scrim-slot-chip']"));
    expect(first).toHaveAttribute("data-status", "Open");
    expect(first).toHaveTextContent("scrims.slotStatus.open");
  });

  it("lists every status a chip can word as a key", () => {
    show({ today: today(), week: OPEN_WEEK });
    const key = screen.getByRole("list", { name: "scrims.slotStatusKey" });
    expect(within(key).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "scrims.slotStatus.open",
      "scrims.slotStatus.locked",
      "scrims.slotStatus.played",
      "scrims.slotStatus.reviewed",
      "scrims.slotStatus.cancelled",
      "scrims.slotStatus.notPlayed",
    ]);
  });

  it("carries today's opponent and, while the block is still to play, today's risk", () => {
    show({
      today: today({ state: "Planned", slotIndex: 0, opponentTeamId: "northglass" }),
      week: week([slot(0, { plan: ["northglass"] }), slot(1), slot(2), slot(3)]),
    });

    const bar = document.querySelector("[data-slot='scrim-day-bar']") as HTMLElement;
    expect(bar).toHaveTextContent("scrims.todayOpponent");
    expect(bar).toHaveTextContent("Northglass");
    expect(bar).toHaveTextContent("scrims.todayRisk");
    expect(bar.querySelector("[data-risk]")).not.toBeNull();
  });

  it("drops the bar once the day is closed, so block A's rival is not shown after block B", () => {
    const blockA = report({ post_decision: "PushThrough" });
    const blockB = report({ slot_index: 1, opponent_team_id: "ember", post_decision: "DayOff" });
    show({
      // The game points back at block A (Northglass) after the day closes.
      today: today({ state: "Reviewed", slotIndex: 0, opponentTeamId: "northglass", resolvedOpponentTeamId: "northglass", report: blockA }),
      week: week(
        [
          slot(0, { status: "Reviewed", resolvedOpponentTeamId: "northglass", resultWon: false, report: blockA, canEdit: false }),
          slot(1, { status: "Reviewed", resolvedOpponentTeamId: "ember", resultWon: true, report: blockB, canEdit: false }),
          slot(2),
          slot(3),
        ],
        { setupLocked: true, setupLockedReason: "week_started" },
      ),
    });

    expect(document.querySelector("[data-slot='scrim-day-bar']")).toBeNull();
    // The chips still tell each block's own rival.
    const [wedA, wedB] = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='scrim-slot-chip']"));
    expect(wedA).toHaveTextContent("Northglass");
    expect(wedB).toHaveTextContent("Ember Five");
  });

  it("drops the risk once the block has been played", () => {
    const played = report();
    show({
      today: today({ state: "PlayedNeedsReview", slotIndex: 0, opponentTeamId: "northglass", resolvedOpponentTeamId: "northglass", report: played, canReview: true }),
      week: week([slot(0, { status: "Played", report: played, resolvedOpponentTeamId: "northglass", resultWon: false }), slot(1), slot(2), slot(3)]),
    });

    const bar = document.querySelector("[data-slot='scrim-day-bar']") as HTMLElement;
    expect(bar).toHaveTextContent("Northglass");
    expect(bar).not.toHaveTextContent("scrims.todayRisk");
  });
});

describe("the assistant", () => {
  it("is a pressed toggle that explains itself and keeps the setup read-only with its reason", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, scrim_review_mode: "assistant" } });
    show({ today: today(), week: OPEN_WEEK });

    const toggle = screen.getByRole("button", { name: "scrims.assistantLabel" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("scrims.assistantModeHint")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("scrims.assistantHandling");
    screen.getAllByRole("radio").forEach((radio) => expect(radio).toBeDisabled());

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().settings.scrim_review_mode).toBe("manual");
  });
});
