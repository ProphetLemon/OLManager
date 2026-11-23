import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { buildPhoneHome, type PhoneHomeInput } from "@/lib/scrims/phoneHome";
import type { TodayScrimContext, WeeklyScrimContext, WeeklyScrimSlotContext } from "@/lib/scrims/scrimContext";
import type { ScrimReportData, TeamData } from "@/store/gameStore";
import { ScrimWeekHome } from "./ScrimWeekHome";

const WEEKDAYS: Record<number, number[]> = { 2: [2, 2], 4: [2, 2, 3, 3], 6: [2, 2, 3, 3, 4, 4] };
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const team = (id: string, name: string, short: string): TeamData =>
  ({ id, name, short_name: short, logo_url: null, country: "ES", colors: { primary: "#000", secondary: "#fff" } }) as unknown as TeamData;
const MINE = team("mine", "Mine FC", "MIN");
const TEAMS = [MINE, team("a", "Alpha Esports", "ALP"), team("b", "Bravo Gaming", "BRA"), team("c", "Charlie Club", "CHA"), team("d", "Delta Team", "DEL")];
const NAMES = new Map(TEAMS.map((entry) => [entry.id, entry.name]));

function report(over: Partial<ScrimReportData> = {}): ScrimReportData {
  return {
    date: "2026-03-11", week_key: "w", slot_index: 0, weekday: 2, team_id: "mine", opponent_team_id: "a", status: "Played",
    won: false, focus: "Macro", issue: "LanePressure", severity: 2, quality: 61, player_champion_picks: [], post_decision: null,
    created_on: "2026-03-11", ...over,
  } as ScrimReportData;
}

type SlotSpec = Partial<WeeklyScrimSlotContext>;
function makeWeek(capacity: 2 | 4 | 6 = 4, specs: Record<number, SlotSpec> = {}, over: Partial<WeeklyScrimContext> = {}): WeeklyScrimContext {
  const slots = WEEKDAYS[capacity].map((weekday, slotIndex) => ({
    slotIndex, weekday, label: "", labelDay: weekday, labelSuffix: slotIndex % 2 === 0 ? "A" : "B", plan: [],
    resolvedOpponentTeamId: null, resultWon: null, report: null, status: "Open", canEdit: true, ...specs[slotIndex],
  })) as WeeklyScrimSlotContext[];
  return {
    weekKey: "w", objective: "EarlyGame", capacity, planned: slots.filter((s) => s.plan.length > 0).length, reputation: 50,
    cancellations: 0, played: 0, wins: 0, losses: 0, lossStreak: 0, avgQuality: 0, topFocus: null, topIssue: null,
    nextOfficialRivalTeamId: null, nextOfficialRivalCompetition: null, setupLocked: false, setupLockedReason: null,
    canFinalizeSetup: true, slots, latestReports: [], ...over,
  } as WeeklyScrimContext;
}
const makeToday = (over: Partial<TodayScrimContext> = {}): TodayScrimContext =>
  ({
    state: "NoScrimToday", slotIndex: null, opponentTeamId: null, resolvedOpponentTeamId: null, objective: null, report: null,
    canEditPlan: false, canCancel: false, canReview: false, canViewWeeklyPlan: true, hasOfficialMatch: false, primaryAction: null,
    pushThroughRecommended: false, ...over,
  }) as TodayScrimContext;

const planned = (...ids: string[]): SlotSpec => ({ plan: ids });
const lockedPlan = (...ids: string[]): SlotSpec => ({ plan: ids, status: "Locked", canEdit: false });
const played = (won: boolean, quality = 68, status: "Played" | "Reviewed" = "Played"): SlotSpec => ({
  status, canEdit: false, plan: ["a"], resolvedOpponentTeamId: "a", resultWon: won, report: report({ won, quality }),
});
const decideToday = makeToday({ state: "PlayedNeedsReview", slotIndex: 0, report: report({ won: false, quality: 61 }), canReview: true });
const plannedToday = (slotIndex = 0) => makeToday({ state: "Planned", slotIndex, opponentTeamId: "a", resolvedOpponentTeamId: "a", canEditPlan: true });

const onOpen = vi.fn();

function mount(week: WeeklyScrimContext, today = makeToday(), extra: Partial<PhoneHomeInput> = {}, lockText: string | null = null, message = "The day's sentence.") {
  return render(
    <ScrimWeekHome
      home={buildPhoneHome({ week, today, ...extra })}
      myTeam={MINE}
      teams={TEAMS}
      weekdayLabels={DAY_LABELS}
      teamNameById={NAMES}
      todayMessage={message}
      lockText={lockText}
      onOpen={onOpen}
    />,
  );
}

const hero = () => document.querySelector('[data-slot="phone-week-hero"]') as HTMLElement;
const blocks = () => [...document.querySelectorAll('[data-slot="phone-week-block"]')] as HTMLElement[];
const lockWeek = { setupLocked: true, setupLockedReason: "week_started" as const };

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});

describe("Semana: the three entries", () => {
  it("shows the objective, the volume with its days and the record, each a button that opens its view", () => {
    mount(makeWeek(4, { 0: played(true, 70, "Reviewed"), 1: played(false, 60, "Reviewed"), 2: played(false, 55, "Reviewed"), 3: planned("d") }, { wins: 1, losses: 2, played: 3 }));
    const entries = document.querySelector('[data-slot="phone-week-entries"]') as HTMLElement;
    expect(within(entries).getAllByRole("button")).toHaveLength(3);

    const objective = within(entries).getByRole("button", { name: /Weekly Objective: Fix early game/ });
    expect(objective).toHaveTextContent("Fix early game");
    const volume = within(entries).getByRole("button", { name: /Weekly Volume: 4, Wed, Thu/ });
    expect(volume).toHaveTextContent("4");
    expect(volume).toHaveTextContent("Wed Thu");
    const reportEntry = within(entries).getByRole("button", { name: /Weekly Report: 1-2/ });
    expect(reportEntry).toHaveTextContent("1-2");
    expect(reportEntry).toHaveTextContent("Week Record");

    fireEvent.click(objective);
    fireEvent.click(volume);
    fireEvent.click(reportEntry);
    expect(onOpen.mock.calls).toEqual([["objective", "objective"], ["volume", "volume"], ["report", "report"]]);
  });

  it("says there is no objective, and that there are no recent reports before a block has a result", () => {
    mount(makeWeek(4, {}, { objective: null }));
    expect(screen.getByRole("button", { name: /Weekly Objective: No objective set/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Weekly Report: No recent reports/ })).toHaveTextContent("No recent reports");
  });
});

describe("Semana: the hero in each of its seven states", () => {
  it("1 decide: slot, the word Decide, the matchup, the result, the quality and a button that opens that slot", () => {
    mount(makeWeek(4, { 0: played(false, 61) }, lockWeek), decideToday);
    expect(hero()).toHaveAttribute("data-state", "decide");
    expect(hero().tagName).toBe("SECTION");
    expect(hero()).toHaveTextContent("Wed A");
    expect(hero()).toHaveTextContent("Decide");
    expect(hero()).toHaveTextContent("Loss");
    expect(hero()).toHaveTextContent("Q61");
    expect(hero()).toHaveTextContent("Your Team");
    expect(hero()).toHaveTextContent("Alpha Esports");
    expect(hero()).toHaveTextContent("Locked");
    const button = within(hero()).getByRole("button", { name: /Decide/ });
    expect(within(hero()).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith("slot:0", "hero");
  });

  it("1 decide after a win says Win", () => {
    mount(makeWeek(4, { 0: played(true, 80) }, lockWeek), makeToday({ state: "PlayedNeedsReview", slotIndex: 0, report: report({ won: true, quality: 80 }), canReview: true }));
    expect(hero()).toHaveTextContent("Win");
    expect(hero()).toHaveTextContent("Q80");
  });

  it("2 today: the word Today, the rival, today's risk, plans A B C, the day's sentence and the lock sentence; not a button", () => {
    mount(makeWeek(4, { 0: lockedPlan("a", "b") }, { ...lockWeek, objective: "Macro" }), plannedToday(), { todayRisk: "medium" }, "The week is locked until Monday.", "Nothing to decide right now.");
    expect(hero()).toHaveAttribute("data-state", "today");
    expect(within(hero()).queryAllByRole("button")).toHaveLength(0);
    expect(hero()).toHaveTextContent("Wed A");
    expect(hero()).toHaveTextContent("Today");
    expect(hero()).toHaveTextContent("Today's Opponent");
    expect(hero()).toHaveTextContent("Alpha Esports");
    expect(hero()).toHaveTextContent("Today's Risk");
    expect(hero()).toHaveTextContent("Medium");
    expect(hero()).toHaveTextContent("Nothing to decide right now.");
    // The lock is its icon and its word, as in states 1 and 6; the full sentence stays in the views.
    expect(hero()).toHaveTextContent("Locked");
    expect(hero()).not.toHaveTextContent("The week is locked until Monday.");
    const plans = within(hero()).getByRole("list", { name: "Opponent plans" });
    expect(within(plans).getAllByRole("listitem")).toHaveLength(3);
    expect(within(plans).getByRole("img", { name: "Alpha Esports" })).toBeInTheDocument();
    expect(within(plans).getByRole("img", { name: "Bravo Gaming" })).toBeInTheDocument();
  });

  it("2 today keeps the day's sentence whole for a long rival name, apart from the lock", () => {
    const long = { ...TEAMS[1], name: "Team Heretics Academy" } as TeamData;
    const names = new Map(NAMES).set("a", long.name);
    const message = "Nothing to decide right now. Wed A plays against Team Heretics Academy when you continue.";
    render(
      <ScrimWeekHome
        home={buildPhoneHome({ week: makeWeek(4, { 0: lockedPlan("a") }, lockWeek), today: plannedToday() })}
        myTeam={MINE}
        teams={[MINE, long, ...TEAMS.slice(2)]}
        weekdayLabels={DAY_LABELS}
        teamNameById={names}
        todayMessage={message}
        lockText="The full lock sentence."
        onOpen={onOpen}
      />,
    );
    const sentence = within(hero()).getByText(message);
    expect(sentence.className).toContain("line-clamp-2");
    expect(sentence).not.toHaveTextContent("Locked");
    expect(within(hero()).getByText("Locked")).toBeInTheDocument();
  });

  it("2 today without a risk shows no risk label", () => {
    mount(makeWeek(4, { 0: lockedPlan("a") }, lockWeek), plannedToday());
    expect(hero()).not.toHaveTextContent("Today's Risk");
  });

  it("3 career started late: a lock and the sentence; not a button", () => {
    mount(makeWeek(4, {}, { setupLocked: true, setupLockedReason: "career_started_late" }), makeToday(), {}, "Your career starts after this week's scrim days.");
    expect(hero()).toHaveAttribute("data-state", "careerStartLate");
    expect(hero()).toHaveTextContent("Your career starts after this week's scrim days.");
    expect(within(hero()).queryAllByRole("button")).toHaveLength(0);
  });

  it("4 next on the objective: its heading, the word Next and the description; a button that opens Objective", () => {
    mount(makeWeek(4, {}, { objective: null }));
    expect(hero()).toHaveAttribute("data-state", "nextObjective");
    expect(hero()).toHaveTextContent("Weekly objective");
    expect(hero()).toHaveTextContent("Next");
    expect(hero()).toHaveTextContent("Define what you want to learn this week.");
    expect(hero().tagName).toBe("BUTTON");
    fireEvent.click(hero());
    expect(onOpen).toHaveBeenCalledWith("objective", "hero");
  });

  it("5 next on a slot with no Plan A: your shield against an empty one, Not planned; a button that opens the slot", () => {
    mount(makeWeek(4, { 0: planned("a") }));
    expect(hero()).toHaveAttribute("data-state", "nextSlot");
    expect(hero()).toHaveTextContent("Wed B");
    expect(hero()).toHaveTextContent("Next");
    expect(hero()).toHaveTextContent("Not planned");
    expect(hero().tagName).toBe("BUTTON");
    fireEvent.click(hero());
    expect(onOpen).toHaveBeenCalledWith("slot:1", "hero");
  });

  it("6 no tag, a block still to play: the first one with its Plan A and the fallbacks; a button when it can be edited", () => {
    mount(makeWeek(4, { 0: planned("a", "b", "c"), 1: planned("d"), 2: planned("b"), 3: planned("c") }, { objective: "Macro" }));
    expect(hero()).toHaveAttribute("data-state", "upNext");
    expect(hero()).toHaveTextContent("Wed A");
    expect(hero()).toHaveTextContent("Next");
    expect(hero()).toHaveTextContent("Alpha Esports");
    expect(within(hero()).getByRole("img", { name: "Bravo Gaming" })).toBeInTheDocument();
    expect(within(hero()).getByRole("img", { name: "Charlie Club" })).toBeInTheDocument();
    expect(hero()).toHaveTextContent("Plan B");
    expect(hero()).toHaveTextContent("Plan C");
    expect(hero().tagName).toBe("BUTTON");
    fireEvent.click(hero());
    expect(onOpen).toHaveBeenCalledWith("slot:0", "hero");
  });

  it("6 a week that cannot be edited with empty blocks: the first block ahead, your shield against an empty one, Not planned and the lock; opens nothing", () => {
    mount(makeWeek(4, {}, lockWeek));
    expect(hero()).toHaveAttribute("data-state", "upNext");
    expect(hero().tagName).toBe("SECTION");
    expect(hero()).toHaveTextContent("Wed A");
    expect(hero()).toHaveTextContent("Next");
    expect(hero()).toHaveTextContent("Not planned");
    expect(hero()).toHaveTextContent("Locked");
    expect(hero().querySelector('[data-slot="phone-empty-shield"]')).not.toBeNull();
    expect(within(hero()).getByRole("img", { name: "Mine FC" })).toBeInTheDocument();
    expect(within(hero()).queryAllByRole("button")).toHaveLength(0);
  });

  it("6 on a locked week the hero shows a lock and Locked and opens nothing", () => {
    mount(makeWeek(4, { 0: lockedPlan("a"), 1: lockedPlan("b"), 2: lockedPlan("c"), 3: lockedPlan("d") }, lockWeek));
    expect(hero()).toHaveAttribute("data-state", "upNext");
    expect(hero().tagName).toBe("SECTION");
    expect(hero()).toHaveTextContent("Locked");
    expect(within(hero()).queryAllByRole("button")).toHaveLength(0);
  });

  it("6 on a closed day adds the day's sentence as one line", () => {
    mount(makeWeek(4, { 0: played(true, 70, "Reviewed"), 1: lockedPlan("b"), 2: lockedPlan("c"), 3: lockedPlan("d") }, lockWeek), makeToday({ state: "Reviewed", slotIndex: 1 }));
    expect(hero()).toHaveTextContent("Today’s review was already applied.");
  });

  it("7 nothing left to play: the record and Week Record; a button that opens the report", () => {
    const week = makeWeek(2, { 0: played(true, 70, "Reviewed"), 1: played(false, 55, "Reviewed") }, { ...lockWeek, wins: 1, losses: 1, played: 2 });
    mount(week);
    expect(hero()).toHaveAttribute("data-state", "report");
    expect(hero()).toHaveTextContent("1-1");
    expect(hero()).toHaveTextContent("Week Record");
    expect(hero().tagName).toBe("BUTTON");
    fireEvent.click(hero());
    expect(onOpen).toHaveBeenCalledWith("report", "hero");
  });
});

describe("Semana: the day groups", () => {
  it("draws one group per day that has blocks: a volume of 2 gives one group, 4 gives two, 6 gives three", () => {
    const groups = () => document.querySelectorAll('[data-slot="phone-week-day"]').length;
    const { unmount } = mount(makeWeek(2));
    expect(groups()).toBe(1);
    unmount();
    const four = mount(makeWeek(4));
    expect(groups()).toBe(2);
    four.unmount();
    mount(makeWeek(6));
    expect(groups()).toBe(3);
    expect(screen.getAllByRole("group", { name: "Fri" })).toHaveLength(1);
  });

  it("planned block: the logo and the name of the rival, a button that opens it; logos carry the team's name", () => {
    mount(makeWeek(4, { 0: planned("a"), 1: planned("b"), 2: planned("c"), 3: planned("d") }));
    const alpha = blocks()[0];
    expect(alpha.tagName).toBe("BUTTON");
    expect(alpha).toHaveTextContent("Alpha Esports");
    expect(within(alpha).getByRole("img", { name: "Alpha Esports" })).toBeInTheDocument();
    expect(alpha).toHaveAccessibleName(/A.*Alpha Esports/);
    fireEvent.click(blocks()[1]);
    expect(onOpen).toHaveBeenCalledWith("slot:1", "block:slot:1");
  });

  it("the hero's block is ringed and carries the hero's word (Next, Today, Decide)", () => {
    const { unmount } = mount(makeWeek(4, { 0: planned("a", "b"), 1: planned("b"), 2: planned("c"), 3: planned("d") }));
    expect(blocks()[0]).toHaveAttribute("data-hero", "true");
    expect(blocks()[0]).toHaveTextContent("Next");
    expect(blocks().filter((block) => block.getAttribute("data-hero") === "true")).toHaveLength(1);
    unmount();

    const decide = mount(makeWeek(4, { 0: played(false, 61), 1: lockedPlan("b"), 2: lockedPlan("c"), 3: lockedPlan("d") }, lockWeek), decideToday);
    expect(blocks()[0]).toHaveTextContent("Decide");
    decide.unmount();

    mount(makeWeek(4, { 0: lockedPlan("a"), 1: lockedPlan("b"), 2: lockedPlan("c"), 3: lockedPlan("d") }, lockWeek), plannedToday());
    expect(blocks()[0]).toHaveTextContent("Today");
    expect(blocks()[0]).toHaveAttribute("data-hero", "true");
  });

  it("played or reviewed block: the result badge and the quality", () => {
    mount(makeWeek(4, { 0: played(false, 68, "Reviewed"), 1: played(true, 74), 2: lockedPlan("c"), 3: lockedPlan("d") }, lockWeek));
    expect(blocks()[0]).toHaveTextContent("Q68");
    expect(within(blocks()[0]).getByText("Loss")).toBeInTheDocument();
    expect(blocks()[1]).toHaveTextContent("Q74");
    expect(within(blocks()[1]).getByText("Win")).toBeInTheDocument();
    expect(blocks()[0].querySelector('[data-slot="phone-week-result"]')).not.toBeNull();
  });

  it("cancelled block: the name, the cross and the word Cancelled; not a button", () => {
    mount(makeWeek(4, {
      0: { ...played(false, 61, "Reviewed"), report: report({ post_decision: "VodReview" }) },
      1: { status: "Cancelled", canEdit: false, plan: ["b"] },
      2: lockedPlan("c"),
      3: lockedPlan("d"),
    }, lockWeek));
    const cancelled = blocks()[1];
    expect(cancelled.tagName).toBe("DIV");
    expect(cancelled).toHaveTextContent("Bravo Gaming");
    expect(cancelled).toHaveTextContent("Cancelled");
    expect(cancelled.querySelector("svg")).not.toBeNull();
  });

  it("a past block that was never played says Not played; not a button", () => {
    mount(makeWeek(4, { 0: played(true, 70, "Reviewed"), 1: { status: "Cancelled", canEdit: false, plan: [] }, 2: lockedPlan("c"), 3: lockedPlan("d") }, lockWeek));
    expect(blocks()[1].tagName).toBe("DIV");
    expect(blocks()[1]).toHaveTextContent("Not played");
  });

  it("a block with no rival shows an empty shield and Not planned, and is a button while it can be edited", () => {
    mount(makeWeek(4, { 0: planned("a") }));
    const empty = blocks()[1];
    expect(empty).toHaveTextContent("Not planned");
    expect(empty.querySelector('[data-slot="phone-empty-shield"]')).not.toBeNull();
    expect(empty.tagName).toBe("BUTTON");
  });

  it("a plan cleared today shows Plan cleared with an empty shield", () => {
    mount(makeWeek(4, {
      0: { ...played(false, 61, "Reviewed"), report: report({ post_decision: "VodReview" }) },
      1: { plan: [] },
      2: lockedPlan("c"),
      3: lockedPlan("d"),
    }, lockWeek));
    expect(blocks()[1]).toHaveTextContent("Plan cleared");
    expect(blocks()[1].querySelector('[data-slot="phone-empty-shield"]')).not.toBeNull();
  });

  it("a locked planned block still opens (to look at its plans)", () => {
    mount(makeWeek(4, { 0: lockedPlan("a"), 1: lockedPlan("b"), 2: lockedPlan("c"), 3: lockedPlan("d") }, lockWeek));
    expect(blocks().every((block) => block.tagName === "BUTTON")).toBe(true);
  });

  it("never tells a state by opacity: no block or hero uses a dimming class", () => {
    mount(makeWeek(4, { 0: played(true, 70, "Reviewed"), 1: { status: "Cancelled", canEdit: false, plan: ["b"] }, 2: lockedPlan("c"), 3: lockedPlan("d") }, lockWeek));
    for (const element of [...blocks(), hero()]) expect(element.className).not.toMatch(/opacity/);
  });
});

describe("Semana: markup and heights", () => {
  it("a hero that is a button holds only phrasing content", () => {
    const cases: Array<() => void> = [
      () => mount(makeWeek(4, {}, { objective: null })),
      () => mount(makeWeek(4, { 0: planned("a") })),
      () => mount(makeWeek(4, { 0: planned("a", "b", "c"), 1: planned("d"), 2: planned("b"), 3: planned("c") })),
      () => mount(makeWeek(2, { 0: played(true, 70, "Reviewed"), 1: played(false, 55, "Reviewed") }, { ...lockWeek, wins: 1, losses: 1 })),
    ];
    for (const run of cases) {
      const { unmount } = (run(), { unmount: () => document.body.replaceChildren() });
      expect(hero().tagName).toBe("BUTTON");
      expect(hero().querySelectorAll("div, ul, li, p, section, h1, h2, h3")).toHaveLength(0);
      unmount();
    }
  });

  it("the Informe entry's name contains what it shows", () => {
    mount(makeWeek(4, { 0: played(true, 70, "Reviewed"), 1: planned("b"), 2: planned("c"), 3: planned("d") }, { wins: 1, losses: 0, played: 1 }));
    const entryButton = document.querySelector('[data-home-control="report"]') as HTMLElement;
    expect(entryButton).toHaveAccessibleName(/1-0/);
    expect(entryButton).toHaveAccessibleName(/Week Record/);
  });

  it("fits two blocks in 116 px (a 16 px header, 2 px gaps, two targets) and gives a taller area to the hero", () => {
    mount(makeWeek(4, { 0: planned("a"), 1: planned("b"), 2: planned("c"), 3: planned("d") }));
    const days = document.querySelector('[data-slot="phone-week-days"]') as HTMLElement;
    expect(days.className).toContain("h-[7.25rem]");
    expect(days.className).toContain("shrink-0");
    const header = document.querySelector('[data-slot="phone-week-day"] > span') as HTMLElement;
    expect(header.className).toContain("h-4");
    expect(hero().className).toContain("min-h-[5.625rem]");
    expect(hero().className).toContain("flex-1");
  });
});

describe("Semana: the logos", () => {
  it("draws the real logo of each rival (an image, not a monogram) with its team's name", () => {
    mount(makeWeek(4, { 0: planned("a"), 1: planned("b"), 2: planned("c"), 3: planned("d") }));
    const logo = within(blocks()[0]).getByRole("img", { name: "Alpha Esports" });
    expect(logo.tagName).toBe("IMG");
    expect(logo).toHaveAttribute("src", expect.stringContaining("/teams-icons/alp.webp"));
  });

  it("names your own club on the hero's matchup", () => {
    mount(makeWeek(4, { 0: planned("a", "b", "c"), 1: planned("d"), 2: planned("b"), 3: planned("c") }));
    expect(within(hero()).getByRole("img", { name: "Mine FC" })).toBeInTheDocument();
  });
});
