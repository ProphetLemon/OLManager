import { describe, expect, it } from "vitest";

import type { ScrimReportData } from "@/store/gameStore";
import type { TodayScrimContext, WeeklyScrimContext, WeeklyScrimSlotContext } from "./scrimContext";
import { buildPhoneWeek, phoneDoneTarget, slotRowId, type PhoneCell, type PhoneSlotCell, type PhoneTag } from "./phoneWeek";

const WEEKDAYS: Record<number, number[]> = { 2: [2, 2], 4: [2, 2, 3, 3], 6: [2, 2, 3, 3, 4, 4] };

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
    quality: 61,
    player_champion_picks: [],
    post_decision: null,
    created_on: "2026-03-11",
    ...overrides,
  };
}

type SlotSpec = Partial<WeeklyScrimSlotContext>;

/** A week of `capacity` slots (Wed/Thu/Fri blocks A and B); `specs` overrides slots by index. */
function makeWeek(
  capacity: 2 | 4 | 6 = 6,
  specs: Record<number, SlotSpec> = {},
  overrides: Partial<WeeklyScrimContext> = {},
): WeeklyScrimContext {
  const weekdays = WEEKDAYS[capacity];
  const slots: WeeklyScrimSlotContext[] = weekdays.map((weekday, slotIndex) => ({
    slotIndex,
    weekday,
    label: "",
    labelDay: weekday,
    labelSuffix: slotIndex % 2 === 0 ? "A" : "B",
    plan: [],
    resolvedOpponentTeamId: null,
    resultWon: null,
    report: null,
    status: "Open",
    canEdit: true,
    ...specs[slotIndex],
  }));
  return {
    weekKey: "2026-W11",
    objective: "EarlyGame",
    capacity,
    planned: slots.filter((slot) => slot.plan.length > 0 || slot.resolvedOpponentTeamId).length,
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
    slots,
    latestReports: [],
    ...overrides,
  };
}

function makeToday(overrides: Partial<TodayScrimContext> = {}): TodayScrimContext {
  return {
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
    primaryAction: null,
    pushThroughRecommended: false,
    ...overrides,
  };
}

const plan = (id: string): SlotSpec => ({ plan: [id] });
const cells = (model: ReturnType<typeof buildPhoneWeek>): PhoneCell[] => model.rows.flat();
const tagged = (model: ReturnType<typeof buildPhoneWeek>): Array<[string, PhoneTag]> =>
  cells(model).flatMap((cell) => (cell.tag ? [[cell.id, cell.tag] as [string, PhoneTag]] : []));
const slotCell = (model: ReturnType<typeof buildPhoneWeek>, index: number) =>
  cells(model).find((cell) => cell.id === slotRowId(index)) as PhoneSlotCell;

describe("phone week rows", () => {
  it("lists the objective, then volume and report, then one row per scrim weekday", () => {
    const model = buildPhoneWeek({ week: makeWeek(6), today: makeToday() });
    expect(model.rows.map((row) => row.map((cell) => cell.id))).toEqual([
      ["objective"],
      ["volume", "report"],
      ["slot:0", "slot:1"],
      ["slot:2", "slot:3"],
      ["slot:4", "slot:5"],
    ]);
  });

  it("names the distinct scrim weekdays on the volume cell", () => {
    const cell = cells(buildPhoneWeek({ week: makeWeek(4), today: makeToday() })).find((c) => c.id === "volume");
    expect(cell).toMatchObject({ kind: "volume", capacity: 4, days: [2, 3], locked: false });
  });

  it("marks the objective and volume cells locked once finalized or while the assistant handles the setup", () => {
    const find = (model: ReturnType<typeof buildPhoneWeek>, id: string) => cells(model).find((c) => c.id === id);
    const finalized = buildPhoneWeek({ week: makeWeek(6, {}, { setupLocked: true }), today: makeToday() });
    const assisted = buildPhoneWeek({ week: makeWeek(6), today: makeToday(), readOnly: true });
    for (const model of [finalized, assisted]) {
      expect(find(model, "objective")).toMatchObject({ locked: true });
      expect(find(model, "volume")).toMatchObject({ locked: true });
    }
  });

  it("draws 2 day rows for volume 4 and 1 for volume 2", () => {
    expect(buildPhoneWeek({ week: makeWeek(4), today: makeToday() }).rows).toHaveLength(4);
    expect(buildPhoneWeek({ week: makeWeek(2), today: makeToday() }).rows).toHaveLength(3);
  });
});

describe("phone slot cell", () => {
  it("carries the weekday, the block letter and the rival of Plan A", () => {
    const model = buildPhoneWeek({ week: makeWeek(6, { 3: plan("rivalx") }), today: makeToday() });
    const cell = slotCell(model, 3);
    expect(cell).toMatchObject({ weekday: 3, suffix: "B", status: "Open", rival: { kind: "team", teamId: "rivalx" }, result: null, quality: null });
    expect(slotCell(model, 2).rival).toEqual({ kind: "none" });
  });

  it("words a slot after the setup is finalized as locked", () => {
    const model = buildPhoneWeek({ week: makeWeek(6, { 0: plan("a") }, { setupLocked: true }), today: makeToday() });
    expect(slotCell(model, 0).status).toBe("Locked");
  });

  it("gives a played slot its result and quality, and a reviewed slot the reviewed status", () => {
    const played = report({ quality: 61, won: false });
    const week = makeWeek(6, {
      0: { ...plan("rivalx"), status: "Reviewed", canEdit: false, resolvedOpponentTeamId: "rivalx", resultWon: true, report: report({ won: true, quality: 73, post_decision: "PushThrough" }) },
      1: { ...plan("rivaly"), status: "Played", canEdit: false, resolvedOpponentTeamId: "rivaly", resultWon: false, report: played },
    });
    const model = buildPhoneWeek({ week, today: makeToday() });
    expect(slotCell(model, 0)).toMatchObject({ status: "Reviewed", result: "won", quality: 73 });
    expect(slotCell(model, 1)).toMatchObject({ status: "Played", result: "lost", quality: 61, rival: { kind: "team", teamId: "rivaly" } });
  });

  it("says plan cleared for a second block whose plan the first block's decision cleared", () => {
    const week = makeWeek(6, {
      0: { status: "Reviewed", canEdit: false, report: report({ post_decision: "VodReview" }), resultWon: false, resolvedOpponentTeamId: "northglass" },
    });
    expect(slotCell(buildPhoneWeek({ week, today: makeToday() }), 1).rival).toEqual({ kind: "cleared" });
  });

  it("says not played for a past slot that was never planned", () => {
    const week = makeWeek(6, { 0: { status: "Cancelled", canEdit: false } });
    expect(slotCell(buildPhoneWeek({ week, today: makeToday() }), 0).status).toBe("NotPlayed");
  });
});

describe("phone tags", () => {
  it("puts Next on the objective row of a fresh week", () => {
    const week = makeWeek(6, {}, { objective: null });
    expect(tagged(buildPhoneWeek({ week, today: makeToday() }))).toEqual([["objective", "next"]]);
  });

  it("puts Next on the first slot without Plan A once the objective is set (two of six planned)", () => {
    const week = makeWeek(6, { 0: plan("a"), 1: plan("b") });
    expect(tagged(buildPhoneWeek({ week, today: makeToday() }))).toEqual([["slot:2", "next"]]);
  });

  it("puts Next on a slot with no Plan A even when the objective is empty but something is planned", () => {
    const week = makeWeek(6, { 0: plan("a") }, { objective: null });
    expect(tagged(buildPhoneWeek({ week, today: makeToday() }))).toEqual([["slot:1", "next"]]);
  });

  it("carries no tag when everything is planned", () => {
    const week = makeWeek(6, Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [i, plan(`r${i}`)])));
    expect(tagged(buildPhoneWeek({ week, today: makeToday() }))).toEqual([]);
  });

  it("carries no tag once the setup is finalized", () => {
    const week = makeWeek(6, { 0: plan("a") }, { setupLocked: true });
    expect(tagged(buildPhoneWeek({ week, today: makeToday() }))).toEqual([]);
  });

  it("carries no tag while the assistant handles the setup", () => {
    const week = makeWeek(6, { 0: plan("a") });
    expect(tagged(buildPhoneWeek({ week, today: makeToday(), readOnly: true }))).toEqual([]);
  });

  it("never gives Next to a locked past day that was never planned", () => {
    const week = makeWeek(6, { 0: { status: "Cancelled", canEdit: false }, 1: { status: "Cancelled", canEdit: false } });
    expect(tagged(buildPhoneWeek({ week, today: makeToday() }))).toEqual([["slot:2", "next"]]);
  });

  it("carries no tag when nothing is editable and the week is empty", () => {
    const week = makeWeek(4, { 0: { canEdit: false }, 1: { canEdit: false }, 2: { canEdit: false }, 3: { canEdit: false } }, { objective: null });
    expect(tagged(buildPhoneWeek({ week, today: makeToday() }))).toEqual([]);
  });

  it("puts Today on today's block on a scrim-day morning while it is still to be played", () => {
    const week = makeWeek(6, { 0: plan("mvk"), 1: plan("gam") }, { setupLocked: true });
    const today = makeToday({ state: "Planned", slotIndex: 0, opponentTeamId: "mvk", canEditPlan: true, canCancel: true });
    expect(tagged(buildPhoneWeek({ week, today }))).toEqual([["slot:0", "today"]]);
  });

  it("has no Today once the block is played or the morning is over", () => {
    const week = makeWeek(6, { 0: plan("mvk") }, { setupLocked: true });
    const afternoon = makeToday({ state: "Planned", slotIndex: 0, opponentTeamId: "mvk", canEditPlan: false });
    expect(tagged(buildPhoneWeek({ week, today: afternoon }))).toEqual([]);
  });

  it("puts Decide on the block that was played and waits for its decision", () => {
    const played = report({ slot_index: 0 });
    const week = makeWeek(6, { 0: { ...plan("mvk"), status: "Played", canEdit: false, report: played, resolvedOpponentTeamId: "mvk", resultWon: false } }, { setupLocked: true });
    const today = makeToday({ state: "PlayedNeedsReview", slotIndex: 0, report: played, canReview: true });
    expect(tagged(buildPhoneWeek({ week, today }))).toEqual([["slot:0", "decide"]]);
  });

  it("puts Decide on block B after block A was reviewed and block B was played", () => {
    const reviewedA = report({ slot_index: 0, post_decision: "PushThrough" });
    const playedB = report({ slot_index: 1 });
    const week = makeWeek(6, {
      0: { status: "Reviewed", canEdit: false, report: reviewedA, resolvedOpponentTeamId: "mvk", resultWon: false },
      1: { status: "Played", canEdit: false, report: playedB, resolvedOpponentTeamId: "gam", resultWon: true },
    }, { setupLocked: true });
    const today = makeToday({ state: "PlayedNeedsReview", slotIndex: 1, report: playedB, canReview: true });
    expect(tagged(buildPhoneWeek({ week, today }))).toEqual([["slot:1", "decide"]]);
  });

  it("drops Decide when no decision can be taken (outside the scrim-block phase)", () => {
    const played = report({ slot_index: 0 });
    const week = makeWeek(6, { 0: { status: "Played", canEdit: false, report: played } }, { setupLocked: true });
    const today = makeToday({ state: "PlayedNeedsReview", slotIndex: 0, report: played, canReview: false });
    expect(tagged(buildPhoneWeek({ week, today }))).toEqual([]);
  });
});

describe("where Done leads", () => {
  it("goes to the next editable slot after it with no Plan A", () => {
    const week = makeWeek(6, { 1: plan("b"), 2: plan("c") });
    expect(phoneDoneTarget(week, 0)).toBe("slot:3");
  });

  it("goes to the next editable slot in order when every later slot has a plan", () => {
    const week = makeWeek(6, { 1: plan("b"), 2: plan("c"), 3: plan("d"), 4: plan("e"), 5: plan("f") });
    expect(phoneDoneTarget(week, 0)).toBe("slot:1");
  });

  it("skips slots that cannot be edited", () => {
    const week = makeWeek(6, { 1: { canEdit: false }, 2: { canEdit: false } });
    expect(phoneDoneTarget(week, 0)).toBe("slot:3");
  });

  it("leads to Volume after the last editable slot", () => {
    expect(phoneDoneTarget(makeWeek(6), 5)).toBe("volume");
    expect(phoneDoneTarget(makeWeek(6, { 5: { canEdit: false } }), 4)).toBe("volume");
  });

  it("leads to Volume when the setup is read-only", () => {
    expect(phoneDoneTarget(makeWeek(6), 0, true)).toBe("volume");
  });
});
