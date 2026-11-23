import { describe, expect, it } from "vitest";

import type { ScrimReportData } from "@/store/gameStore";
import type { TodayScrimContext, WeeklyScrimContext, WeeklyScrimSlotContext } from "./scrimContext";
import { buildPhoneHome, type PhoneBlock, type PhoneHomeInput } from "./phoneHome";

const WEEKDAYS: Record<number, number[]> = { 2: [2, 2], 4: [2, 2, 3, 3], 6: [2, 2, 3, 3, 4, 4] };

function report(overrides: Partial<ScrimReportData> = {}): ScrimReportData {
  return {
    date: "2026-03-11", week_key: "2026-W11", slot_index: 0, weekday: 2, team_id: "mine",
    opponent_team_id: "northglass", status: "Played", won: false, focus: "Macro", issue: "ObjectiveSetup",
    severity: 2, quality: 61, player_champion_picks: [], post_decision: null, created_on: "2026-03-11",
    ...overrides,
  };
}

type SlotSpec = Partial<WeeklyScrimSlotContext>;

function makeWeek(capacity: 2 | 4 | 6 = 6, specs: Record<number, SlotSpec> = {}, overrides: Partial<WeeklyScrimContext> = {}): WeeklyScrimContext {
  const slots: WeeklyScrimSlotContext[] = WEEKDAYS[capacity].map((weekday, slotIndex) => ({
    slotIndex, weekday, label: "", labelDay: weekday, labelSuffix: slotIndex % 2 === 0 ? "A" : "B",
    plan: [], resolvedOpponentTeamId: null, resultWon: null, report: null, status: "Open", canEdit: true,
    ...specs[slotIndex],
  }));
  return {
    weekKey: "2026-W11", objective: "EarlyGame", capacity,
    planned: slots.filter((s) => s.plan.length > 0 || s.resolvedOpponentTeamId).length,
    reputation: 50, cancellations: 0, played: 0, wins: 0, losses: 0, lossStreak: 0, avgQuality: 0,
    topFocus: null, topIssue: null, nextOfficialRivalTeamId: null, nextOfficialRivalCompetition: null,
    setupLocked: false, setupLockedReason: null, canFinalizeSetup: true, slots, latestReports: [],
    ...overrides,
  };
}

function makeToday(overrides: Partial<TodayScrimContext> = {}): TodayScrimContext {
  return {
    state: "NoScrimToday", slotIndex: null, opponentTeamId: null, resolvedOpponentTeamId: null, objective: null,
    report: null, canEditPlan: false, canCancel: false, canReview: false, canViewWeeklyPlan: true,
    hasOfficialMatch: false, primaryAction: null, pushThroughRecommended: false,
    ...overrides,
  };
}

const plan = (...ids: string[]): SlotSpec => ({ plan: ids });
const played = (won: boolean, quality = 61): SlotSpec => ({
  status: "Played", canEdit: false, plan: ["northglass"], resolvedOpponentTeamId: "northglass", resultWon: won, report: report({ won, quality }),
});
const reviewed = (won: boolean): SlotSpec => ({ ...played(won), status: "Reviewed" });
const home = (input: Partial<PhoneHomeInput> & Pick<PhoneHomeInput, "week">) =>
  buildPhoneHome({ today: makeToday(), ...input });
const blocks = (model: ReturnType<typeof buildPhoneHome>): PhoneBlock[] => model.days.flatMap((day) => day.blocks);
const block = (model: ReturnType<typeof buildPhoneHome>, index: number) => blocks(model).find((b) => b.slotIndex === index)!;

const decideToday = makeToday({ state: "PlayedNeedsReview", slotIndex: 0, report: report({ won: true, quality: 72 }), canReview: true });
const plannedToday = makeToday({ state: "Planned", slotIndex: 0, canEditPlan: true, opponentTeamId: "a" });

describe("hero of Semana, one row per state of BUILD-SPEC section 2", () => {
  it("1 decide: a row carries decide; it shows the result and the quality and opens that slot", () => {
    const week = makeWeek(6, { 0: { ...played(true), report: report({ won: true, quality: 72 }) } }, { setupLocked: true });
    expect(home({ week, today: decideToday }).hero).toMatchObject({
      state: "decide", slotIndex: 0, opponentTeamId: "northglass", result: "won", quality: 72, opens: "slot:0", locked: true,
    });
  });

  it("2 today: a row carries today; it shows the rival, the risk, plans A B C and the lock sentence, and opens nothing", () => {
    const week = makeWeek(6, { 0: plan("a", "b", "c") }, { setupLocked: true, setupLockedReason: "week_started" });
    expect(home({ week, today: plannedToday, todayRisk: "high" }).hero).toMatchObject({
      state: "today", slotIndex: 0, opponentTeamId: "a", risk: "high", plan: ["a", "b", "c"], dayState: "Planned",
      lockKey: "scrims.setupLockedWeekStarted", opens: null,
    });
  });

  it("2 today: plans B and C are null when the slot has only Plan A and the risk is null when the game gives none", () => {
    const week = makeWeek(6, { 0: plan("a") }, { setupLocked: true });
    expect(home({ week, today: plannedToday }).hero).toMatchObject({ state: "today", plan: ["a", null, null], risk: null });
  });

  it("3 careerStartLate: a locked week from a late career start shows the lock sentence and opens nothing", () => {
    const week = makeWeek(6, {}, { setupLocked: true, setupLockedReason: "career_started_late" });
    expect(home({ week }).hero).toMatchObject({ state: "careerStartLate", lockKey: "scrims.setupLockedCareerStart", opens: null });
  });

  it("4 nextObjective: no objective and nothing planned opens Objetivo", () => {
    expect(home({ week: makeWeek(6, {}, { objective: null }) }).hero).toMatchObject({ state: "nextObjective", opens: "objective" });
  });

  it("5 nextSlot: the first editable slot with no Plan A, with the empty shield, opens Elegir rival", () => {
    const week = makeWeek(6, { 0: plan("x") });
    expect(home({ week }).hero).toMatchObject({ state: "nextSlot", slotIndex: 1, opens: "slot:1" });
  });

  it("6 upNext: no tag; the first block still to be played, with Plan A and the fallbacks, opens Elegir rival while editable", () => {
    const week = makeWeek(2, { 0: plan("a", "b", "c"), 1: plan("d") }, { objective: "EarlyGame" });
    expect(home({ week }).hero).toMatchObject({ state: "upNext", slotIndex: 0, opponentTeamId: "a", plan: ["a", "b", "c"], opens: "slot:0" });
  });

  it("6 upNext: skips played blocks, and on a locked week keeps the lock icon and opens nothing", () => {
    const week = makeWeek(4, { 0: reviewed(true), 1: reviewed(false), 2: plan("p"), 3: plan("q") }, { setupLocked: true, setupLockedReason: "manual" });
    expect(home({ week }).hero).toMatchObject({ state: "upNext", slotIndex: 2, locked: true, opens: null });
  });

  it("7 report: nothing left to play shows the record and opens Informe", () => {
    const week = makeWeek(2, { 0: reviewed(true), 1: reviewed(false) }, { wins: 1, losses: 1, played: 2 });
    expect(home({ week }).hero).toMatchObject({ state: "report", wins: 1, losses: 1, opens: "report" });
  });

  it("first match wins: decide beats today, and today beats a late-start lock", () => {
    const week = makeWeek(6, { 0: { ...played(true), plan: ["a", "b"] } }, { setupLocked: true, setupLockedReason: "career_started_late" });
    expect(home({ week, today: decideToday }).hero.state).toBe("decide");
    const week2 = makeWeek(6, { 0: plan("a") }, { setupLocked: true, setupLockedReason: "career_started_late" });
    expect(home({ week: week2, today: plannedToday }).hero.state).toBe("today");
  });

  it("carries the closed-day sentence once the day is reviewed or cancelled, and none otherwise", () => {
    const week = makeWeek(2, { 0: reviewed(true), 1: reviewed(true) });
    expect(home({ week, today: makeToday({ state: "Reviewed", slotIndex: 0 }) }).hero.closedDayKey).toBe("scrims.todayReviewed");
    expect(home({ week, today: makeToday({ state: "Cancelled", slotIndex: 1 }) }).hero.closedDayKey).toBe("scrims.todayCancelled");
    expect(home({ week }).hero.closedDayKey).toBeNull();
  });

  it("never shows 'slots passed' as a lock: a week that is not locked has no lock key", () => {
    const week = makeWeek(4, { 0: reviewed(true), 1: reviewed(true), 2: plan("p"), 3: plan("q") });
    expect(home({ week }).hero).toMatchObject({ locked: false, lockKey: null });
  });
});

describe("blocks of Semana, one row per state of BUILD-SPEC section 2", () => {
  it("planned: a block with a rival and a free slot is planned, a button and not the hero's", () => {
    const week = makeWeek(4, { 0: plan("a"), 1: plan("b"), 2: plan("c"), 3: plan("d") });
    expect(block(home({ week }), 1)).toMatchObject({ state: "planned", rival: { kind: "team", teamId: "b" }, isHero: false, heroWord: null, opens: true });
  });

  it("hero: the hero's block is flagged with the hero's word", () => {
    const week = makeWeek(2, { 0: plan("a"), 1: plan("b") });
    expect(block(home({ week }), 0)).toMatchObject({ isHero: true, heroWord: "next" });
    const todayModel = home({ week: makeWeek(2, { 0: plan("a") }, { setupLocked: true }), today: plannedToday });
    expect(block(todayModel, 0)).toMatchObject({ isHero: true, heroWord: "today" });
    const decideModel = home({ week: makeWeek(2, { 0: played(true) }), today: decideToday });
    expect(block(decideModel, 0)).toMatchObject({ isHero: true, heroWord: "decide", state: "played", opens: true });
  });

  it("played: a played or reviewed block carries the result and the quality", () => {
    const week = makeWeek(2, { 0: reviewed(true), 1: played(false, 40) });
    const model = home({ week });
    expect(block(model, 0)).toMatchObject({ state: "played", result: "won", quality: 61, opens: true });
    expect(block(model, 1)).toMatchObject({ state: "played", result: "lost", quality: 40 });
  });

  it("cancelled: a past empty block after a cancelling decision keeps its rival and does not open", () => {
    const week = makeWeek(2, {
      0: { ...reviewed(true), report: report({ post_decision: "DayOff" }) },
      1: { status: "Cancelled", canEdit: false, plan: ["b"] },
    });
    expect(block(home({ week }), 1)).toMatchObject({ state: "cancelled", rival: { kind: "team", teamId: "b" }, opens: false });
  });

  it("notPlayed: a past empty block with no cancelling decision before it", () => {
    const week = makeWeek(2, { 0: reviewed(true), 1: { status: "Cancelled", canEdit: false } });
    expect(block(home({ week }), 1)).toMatchObject({ state: "notPlayed", rival: { kind: "none" }, opens: false });
  });

  it("cleared: today's plan cleared by a cancelling decision shows the empty shield", () => {
    const week = makeWeek(2, { 0: { ...reviewed(true), report: report({ post_decision: "DayOff" }) }, 1: { canEdit: false } });
    expect(block(home({ week }), 1)).toMatchObject({ state: "cleared", rival: { kind: "cleared" } });
  });

  it("none: an open block with no rival, a button only while it can be edited", () => {
    const week = makeWeek(2, { 0: plan("a") });
    expect(block(home({ week }), 1)).toMatchObject({ state: "none", rival: { kind: "none" }, opens: true });
    const locked = makeWeek(2, { 0: plan("a") }, { setupLocked: true });
    expect(block(home({ week: locked }), 1)).toMatchObject({ state: "none", opens: false });
  });

  it("a locked planned block still opens, to look at its plans read-only", () => {
    const week = makeWeek(2, { 0: plan("a", "b"), 1: plan("c") }, { setupLocked: true });
    expect(block(home({ week }), 1)).toMatchObject({ state: "planned", opens: true });
  });
});

describe("days and entries of Semana", () => {
  it("draws one day group for volume 2 and two for volume 4, only the days that have blocks", () => {
    const two = home({ week: makeWeek(2) });
    const four = home({ week: makeWeek(4) });
    expect(two.days.map((d) => [d.weekday, d.blocks.length])).toEqual([[2, 2]]);
    expect(four.days.map((d) => [d.weekday, d.blocks.length])).toEqual([[2, 2], [3, 2]]);
    expect(home({ week: makeWeek(6) }).days).toHaveLength(3);
  });

  it("gives the three entries: objective, volume with its days, and report with whether a block has a result", () => {
    const fresh = home({ week: makeWeek(4, {}, { objective: null }) });
    expect(fresh.entries.objective).toMatchObject({ objective: null, locked: false });
    expect(fresh.entries.volume).toMatchObject({ capacity: 4, days: [2, 3] });
    expect(fresh.entries.report).toMatchObject({ wins: 0, losses: 0, hasResult: false });
    const after = home({ week: makeWeek(4, { 0: reviewed(true) }, { wins: 1 }) });
    expect(after.entries.report).toMatchObject({ wins: 1, hasResult: true });
  });
});

describe("hero state 6 counts blocks still ahead, with or without a rival", () => {
  it("a locked week whose blocks have no plan still has blocks ahead: the first one, with no rival, opens nothing", () => {
    const week = makeWeek(4, {}, { setupLocked: true, setupLockedReason: "manual" });
    expect(home({ week }).hero).toMatchObject({ state: "upNext", slotIndex: 0, opponentTeamId: null, plan: [null, null, null], locked: true, opens: null });
  });

  it("the assistant on with empty blocks: the first block ahead, no rival, nothing to open", () => {
    expect(home({ week: makeWeek(4), readOnly: true }).hero).toMatchObject({ state: "upNext", slotIndex: 0, opponentTeamId: null, opens: null });
  });

  it("a past block without a plan (Cancelled, so it reads Not played) is not ahead: the next Open one is", () => {
    const week = makeWeek(4, { 0: { status: "Cancelled", canEdit: false }, 1: { status: "Cancelled", canEdit: false } }, { setupLocked: true, setupLockedReason: "week_started" });
    expect(home({ week }).hero).toMatchObject({ state: "upNext", slotIndex: 2, opponentTeamId: null });
  });

  it("with nothing ahead the hero is still the report", () => {
    const week = makeWeek(2, { 0: reviewed(true), 1: reviewed(false) }, { setupLocked: true, wins: 1, losses: 1 });
    expect(home({ week }).hero).toMatchObject({ state: "report", wins: 1, losses: 1 });
  });
});
