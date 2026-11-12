import { describe, expect, it } from "vitest";

import type { ScrimReportData } from "@/store/gameStore";
import { buildDecisionResult } from "./decisionResult";
import {
  cancelsNextBlock,
  decisionEffectLines,
  isSevereLoss,
  type DecisionEffectContext,
  type EffectLine,
} from "./decisionEffects";

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

function context(overrides: Partial<DecisionEffectContext> = {}): DecisionEffectContext {
  return {
    isFirstBlock: true,
    report: report(),
    lossStreak: 1,
    ownReputation: 38,
    opponentReputation: 44,
    nextBlockLabel: "B",
    ...overrides,
  };
}

const kinds = (lines: EffectLine[]) => lines.map((line) => line.kind);

describe("decisionEffectLines on the first block", () => {
  it("shows what Targeted Drills does to a lost block A, including the cancelled block B", () => {
    expect(decisionEffectLines("TargetedDrills", context())).toEqual([
      { kind: "quality", delta: 10 },
      { kind: "players", morale: 0, condition: -3 },
      { kind: "cancelsNext", label: "B", reputation: -5, cancellations: 1 },
      { kind: "closesDay" },
    ]);
  });

  it("shows Offer rest as a severity cut, a rest for the players and a cancelled block B", () => {
    expect(decisionEffectLines("OfferRest", context({ report: report({ won: true, severity: 1 }) }))).toEqual([
      { kind: "severity", delta: -1 },
      { kind: "players", morale: 5, condition: 6 },
      { kind: "cancelsNext", label: "B", reputation: -5, cancellations: 1 },
      { kind: "closesDay" },
    ]);
  });

  it("shows Continue as a small quality gain that plays block B", () => {
    expect(decisionEffectLines("ContinueToBlock2", context({ report: report({ won: true, severity: 1 }) }))).toEqual([
      { kind: "quality", delta: 2 },
      { kind: "players", morale: 1, condition: 0 },
      { kind: "playsNext", label: "B" },
    ]);
  });

  it("shows Cancel scrims as a step that applies nothing, with the price of the follow-up", () => {
    expect(decisionEffectLines("CancelScrims", context())).toEqual([
      { kind: "cancelStep", label: "B", reputation: -5, cancellations: 1 },
    ]);
  });

  it("cuts the reputation drop to what is left when the reputation is below 5", () => {
    const lines = decisionEffectLines("VodReview", context({ ownReputation: 3 }));
    expect(lines.find((line) => line.kind === "cancelsNext")).toEqual({
      kind: "cancelsNext",
      label: "B",
      reputation: -3,
      cancellations: 1,
    });
  });

  it("leaves out a quality gain that the cap at 100 removes and a severity cut that is already 0", () => {
    const lines = decisionEffectLines("VodReview", context({ report: report({ quality: 100, severity: 0 }) }));
    expect(kinds(lines)).not.toContain("quality");
    expect(kinds(lines)).not.toContain("severity");
    expect(decisionEffectLines("TargetedDrills", context({ report: report({ quality: 97 }) }))[0]).toEqual({
      kind: "quality",
      delta: 3,
    });
  });
});

describe("Push through", () => {
  it("costs 6 condition after an ordinary loss", () => {
    const lines = decisionEffectLines("PushThrough", context());
    expect(lines).toContainEqual({ kind: "players", morale: 0, condition: -6 });
    expect(kinds(lines)).not.toContain("severeLoss");
  });

  it("costs 8 condition and 2 morale after a severe loss, whichever of the three tests it fails", () => {
    const severities = context({ report: report({ severity: 3 }) });
    const streak = context({ lossStreak: 3 });
    const reputation = context({ ownReputation: 54, opponentReputation: 44 });
    for (const severe of [severities, streak, reputation]) {
      const lines = decisionEffectLines("PushThrough", severe);
      expect(lines).toContainEqual({ kind: "players", morale: -2, condition: -8 });
      expect(kinds(lines)).toContain("severeLoss");
    }
  });

  it("never calls a win severe", () => {
    expect(isSevereLoss(report({ won: true, severity: 4 }), 5, 90, 10)).toBe(false);
  });
});

describe("decisionEffectLines on the second block", () => {
  it("closes the day and cancels nothing", () => {
    const second = context({ isFirstBlock: false, nextBlockLabel: null, report: report({ won: true, severity: 1 }) });
    expect(decisionEffectLines("DayOff", second)).toEqual([
      { kind: "severity", delta: -1 },
      { kind: "players", morale: 5, condition: 6 },
      { kind: "closesDay" },
    ]);
    expect(cancelsNextBlock("VodReview", false)).toBe(false);
  });
});

describe("buildDecisionResult", () => {
  const before = { quality: 65, severity: 2, reputation: 38, cancellations: 0 };

  it("reads the cost of a follow-up from the numbers the game returned", () => {
    const result = buildDecisionResult({
      action: "TargetedDrills",
      isFirstBlock: true,
      before,
      after: { quality: 75, severity: 2, reputation: 33, cancellations: 1 },
      players: { morale: 0, condition: -3 },
      nextBlockLabel: "B",
      nextReportWaiting: false,
    });
    expect(result.rows).toEqual([
      { kind: "change", field: "quality", before: 65, after: 75, cost: false },
      { kind: "change", field: "reputation", before: 38, after: 33, cost: true },
      { kind: "change", field: "cancellations", before: 0, after: 1, cost: true },
      { kind: "players", morale: 0, condition: -3 },
      { kind: "block", label: "B", state: "cancelled" },
    ]);
    expect(result.closing).toBe("blockCancelled");
  });

  it("says block 2 was played, with its report waiting, after Continue", () => {
    const result = buildDecisionResult({
      action: "ContinueToBlock2",
      isFirstBlock: true,
      before,
      after: { ...before, quality: 67 },
      players: { morale: 1, condition: 0 },
      nextBlockLabel: "B",
      nextReportWaiting: true,
    });
    expect(result.rows).toContainEqual({ kind: "block", label: "B", state: "played" });
    expect(result.closing).toBe("blockTwoPlayed");
  });

  it("says the next report comes with the next advance when the game holds no report for block B", () => {
    const result = buildDecisionResult({
      action: "PushThrough",
      isFirstBlock: true,
      before,
      after: { ...before, quality: 77 },
      players: { morale: 0, condition: -6 },
      nextBlockLabel: "B",
      nextReportWaiting: false,
    });
    expect(result.rows.some((row) => row.kind === "block")).toBe(false);
    expect(result.closing).toBe("nextReportLater");
  });

  it("closes the day after the second block", () => {
    const result = buildDecisionResult({
      action: "DayOff",
      isFirstBlock: false,
      before,
      after: { ...before, severity: 0 },
      players: { morale: 5, condition: 6 },
      nextBlockLabel: null,
      nextReportWaiting: false,
    });
    expect(result.closing).toBe("dayClosed");
    expect(result.rows.some((row) => row.kind === "block")).toBe(false);
  });
});
