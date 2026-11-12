import { describe, expect, it } from "vitest";

import type { ScrimReportData } from "@/store/gameStore";
import type { TodayScrimContext, WeeklyScrimContext, WeeklyScrimSlotContext } from "./scrimContext";
import { chipRival, deskPanel, displaySlotStatus, isPlanClearedToday, riskLevel, slotsByDay, todayBarOpponentId } from "./scrimDesk";

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

function slot(overrides: Partial<WeeklyScrimSlotContext> & { slotIndex: number }): WeeklyScrimSlotContext {
  const weekday = overrides.weekday ?? 2;
  return {
    weekday,
    label: "Wed A",
    labelDay: weekday,
    labelSuffix: overrides.slotIndex % 2 === 0 ? "A" : "B",
    plan: [],
    resolvedOpponentTeamId: null,
    resultWon: null,
    report: null,
    status: "Open",
    canEdit: true,
    ...overrides,
  };
}

function week(slots: WeeklyScrimSlotContext[], setupLocked = false): WeeklyScrimContext {
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
    setupLocked,
    setupLockedReason: setupLocked ? "week_started" : null,
    canFinalizeSetup: true,
    slots,
    latestReports: [],
  };
}

function today(overrides: Partial<TodayScrimContext>): TodayScrimContext {
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

describe("deskPanel: which body owns the wide column", () => {
  const open = week([slot({ slotIndex: 0 }), slot({ slotIndex: 1 })]);
  const locked = week([slot({ slotIndex: 0 }), slot({ slotIndex: 1 })], true);

  it("shows the decision while a played block waits for the manager and the backend allows it", () => {
    const state = today({ state: "PlayedNeedsReview", report: report(), canReview: true });
    expect(deskPanel(state, locked)).toBe("decision");
  });

  it("does not show the decision when the backend does not allow a review", () => {
    const state = today({ state: "PlayedNeedsReview", report: report(), canReview: false });
    expect(deskPanel(state, locked)).toBe("today");
    expect(deskPanel(state, open)).toBe("setup");
  });

  it("keeps the setup on a Monday with nothing to play, locked or not", () => {
    expect(deskPanel(today({ state: "NoScrimToday" }), open)).toBe("setup");
    expect(deskPanel(today({ state: "NoScrimToday" }), locked)).toBe("setup");
  });

  it("keeps the setup on a scrim morning until the week's setup locks", () => {
    expect(deskPanel(today({ state: "Planned", opponentTeamId: "northglass" }), open)).toBe("setup");
  });

  it("shows today's block once the week is locked and today has a scrim", () => {
    expect(deskPanel(today({ state: "Planned", opponentTeamId: "northglass" }), locked)).toBe("today");
    expect(deskPanel(today({ state: "Reviewed", report: report({ post_decision: "DayOff" }) }), locked)).toBe("today");
    expect(deskPanel(today({ state: "Cancelled" }), locked)).toBe("today");
  });

  it("falls back to the setup for a state it does not know", () => {
    expect(deskPanel(today({ state: "Idle" as TodayScrimContext["state"] }), locked)).toBe("setup");
  });
});

describe("riskLevel", () => {
  it("is decided by the rival's OVR first", () => {
    expect(riskLevel(80, 90, 0)).toBe("high");
    expect(riskLevel(77, 90, 0)).toBe("medium");
  });

  it("reads the larger of the OVR gap and a quarter of the reputation gap below that", () => {
    expect(riskLevel(76, 72, 0)).toBe("high");
    expect(riskLevel(75, 72, 0)).toBe("medium");
    expect(riskLevel(72, 76, 8)).toBe("medium");
    expect(riskLevel(72, 76, 16)).toBe("high");
    expect(riskLevel(72, 76, 3)).toBe("low");
  });
});

describe("isPlanClearedToday", () => {
  const blockA = (post_decision: ScrimReportData["post_decision"]) =>
    slot({
      slotIndex: 0,
      status: "Reviewed",
      resolvedOpponentTeamId: "northglass",
      plan: ["northglass"],
      resultWon: false,
      report: report({ post_decision }),
    });

  it("is true for an Open second block whose first block was decided with a cancelling choice", () => {
    for (const decision of ["DayOff", "VodReview", "MentalReset", "TargetedDrills"] as const) {
      const blockB = slot({ slotIndex: 1 });
      expect(isPlanClearedToday(blockB, week([blockA(decision), blockB], true))).toBe(true);
    }
  });

  it("is false when the first block was continued or pushed through", () => {
    for (const decision of ["ContinuePlan", "PushThrough"] as const) {
      const blockB = slot({ slotIndex: 1 });
      expect(isPlanClearedToday(blockB, week([blockA(decision), blockB], true))).toBe(false);
    }
  });

  it("is false while the first block is still waiting for its decision", () => {
    const blockB = slot({ slotIndex: 1 });
    expect(isPlanClearedToday(blockB, week([blockA(null), blockB], true))).toBe(false);
  });

  it("is false for a block that still has a plan, a report or a past weekday", () => {
    const planned = slot({ slotIndex: 1, plan: ["ember"] });
    const played = slot({ slotIndex: 1, status: "Played", report: report({ slot_index: 1 }) });
    const past = slot({ slotIndex: 1, status: "Cancelled" });
    for (const blockB of [planned, played, past]) {
      expect(isPlanClearedToday(blockB, week([blockA("DayOff"), blockB], true))).toBe(false);
    }
  });

  it("never marks the first block of the day", () => {
    const first = slot({ slotIndex: 0 });
    expect(isPlanClearedToday(first, week([first, slot({ slotIndex: 1 })], true))).toBe(false);
  });
});

describe("chipRival and slotsByDay", () => {
  it("names the opponent played, then Plan A, then the reason there is none", () => {
    expect(chipRival(slot({ slotIndex: 0, resolvedOpponentTeamId: "cinder", plan: ["northglass"] }), false)).toEqual({
      kind: "team",
      teamId: "cinder",
    });
    expect(chipRival(slot({ slotIndex: 0, plan: ["northglass", "cinder"] }), false)).toEqual({
      kind: "team",
      teamId: "northglass",
    });
    expect(chipRival(slot({ slotIndex: 1 }), true)).toEqual({ kind: "cleared" });
    expect(chipRival(slot({ slotIndex: 1 }), false)).toEqual({ kind: "none" });
  });

  it("groups the slots of the week by weekday in slot order", () => {
    const days = slotsByDay(
      week([
        slot({ slotIndex: 0, weekday: 2 }),
        slot({ slotIndex: 1, weekday: 2 }),
        slot({ slotIndex: 2, weekday: 3 }),
        slot({ slotIndex: 3, weekday: 3 }),
      ]),
    );
    expect(days.map((day) => [day.weekday, day.slots.map((entry) => entry.slotIndex)])).toEqual([
      [2, [0, 1]],
      [3, [2, 3]],
    ]);
  });
});

describe("displaySlotStatus", () => {
  const decided = (post_decision: ScrimReportData["post_decision"]) =>
    slot({ slotIndex: 0, status: "Reviewed", plan: ["northglass"], resultWon: false, report: report({ post_decision }) });

  it("reads an Open slot as Locked once the week's setup is confirmed, and leaves it Open before", () => {
    const open = slot({ slotIndex: 0, plan: ["northglass"] });
    expect(displaySlotStatus(open, week([open], true))).toBe("Locked");
    expect(displaySlotStatus(open, week([open], false))).toBe("Open");
  });

  it("keeps the statuses the game reports for a slot that has moved on", () => {
    const reviewed = decided("PushThrough");
    const played = slot({ slotIndex: 1, status: "Played", report: report({ slot_index: 1 }) });
    const locked = slot({ slotIndex: 2, status: "Locked", plan: ["ember"] });
    const all = week([reviewed, played, locked], true);
    expect(displaySlotStatus(reviewed, all)).toBe("Reviewed");
    expect(displaySlotStatus(played, all)).toBe("Played");
    expect(displaySlotStatus(locked, all)).toBe("Locked");
  });

  it("reads a past slot with no plan as not played, since nobody cancelled it", () => {
    const past = slot({ slotIndex: 2, weekday: 3, status: "Cancelled" });
    expect(displaySlotStatus(past, week([decided("PushThrough"), past], true))).toBe("NotPlayed");
    expect(displaySlotStatus(past, week([past], false))).toBe("NotPlayed");
  });

  it("keeps Cancelled for a block that an earlier block of its day cancelled", () => {
    const blockB = slot({ slotIndex: 1, status: "Cancelled" });
    expect(displaySlotStatus(blockB, week([decided("DayOff"), blockB], true))).toBe("Cancelled");
  });
});

describe("todayBarOpponentId", () => {
  it("names the rival while the day is open", () => {
    expect(todayBarOpponentId(today({ state: "Planned", opponentTeamId: "northglass" }))).toBe("northglass");
    expect(
      todayBarOpponentId(today({ state: "PlayedNeedsReview", opponentTeamId: "northglass", resolvedOpponentTeamId: "cinder" })),
    ).toBe("cinder");
  });

  it("names nobody once the day is closed, because the game points back at block A", () => {
    const closed = { opponentTeamId: "northglass", resolvedOpponentTeamId: "northglass" };
    expect(todayBarOpponentId(today({ state: "Reviewed", ...closed }))).toBeNull();
    expect(todayBarOpponentId(today({ state: "Cancelled", ...closed }))).toBeNull();
  });

  it("names nobody for a slot with no rival", () => {
    expect(todayBarOpponentId(today({ state: "Planned" }))).toBeNull();
  });
});
