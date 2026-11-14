import { describe, expect, it } from "vitest";

import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import { buildDraftResultFromRuntime } from "./MatchSimulation";

function champion(id: string, team: "blue" | "red", gold: number, spentGold?: number) {
  return {
    id,
    name: id.toUpperCase(),
    team,
    role: "MID",
    kills: 1,
    deaths: 1,
    assists: 1,
    cs: 100,
    gold,
    ...(spentGold === undefined ? {} : { spentGold }),
  };
}

const snapshot = {
  home_team: { id: "h", name: "Alpha", players: [] },
  away_team: { id: "a", name: "Beta", players: [] },
} as unknown as MatchSnapshot;

function build(champions: ReturnType<typeof champion>[]) {
  return buildDraftResultFromRuntime({
    runtime: {
      timeSec: 1500,
      running: false,
      winner: "blue",
      champions,
      stats: {
        blue: { kills: 5, towers: 6, dragons: 2, barons: 0, gold: 40000 },
        red: { kills: 3, towers: 1, dragons: 1, barons: 0, gold: 35000 },
      },
      events: [],
    } as unknown as LolSimV1RuntimeState,
    snapshot,
    championSelections: null,
  });
}

describe("gold on the end screen result", () => {
  it("carries the gold spent next to the gold in hand, so the screen can show the gold earned", () => {
    const result = build([champion("b1", "blue", 1225, 10400), champion("r1", "red", 300, 9000)]);
    expect(result.playerResults.map((row) => [row.gold, row.spentGold])).toEqual([
      [1225, 10400],
      [300, 9000],
    ]);
  });
});

describe("the gold difference over time on the end screen result", () => {
  const withTimeline = (goldDiffTimeline?: Array<{ minute: number; diff: number }>) =>
    buildDraftResultFromRuntime({
      runtime: {
        timeSec: 1500,
        running: false,
        winner: "blue",
        champions: [],
        stats: {
          blue: { kills: 5, towers: 6, dragons: 2, barons: 0, gold: 40000 },
          red: { kills: 3, towers: 1, dragons: 1, barons: 0, gold: 35000 },
        },
        events: [{ t: 300, text: "BLUE killed a champion", type: "kill" }],
        ...(goldDiffTimeline ? { goldDiffTimeline } : {}),
      } as unknown as LolSimV1RuntimeState,
      snapshot,
      championSelections: null,
    });

  it("keeps what the match recorded", () => {
    const recorded = [
      { minute: 0, diff: 0 },
      { minute: 12, diff: 3100 },
      { minute: 25, diff: 5000 },
    ];
    expect(withTimeline(recorded).goldDiffTimeline).toEqual(recorded);
  });

  it("has no series when the match recorded none, instead of drawing one from the final totals", () => {
    expect(withTimeline().goldDiffTimeline).toEqual([]);
    expect(withTimeline([{ minute: 0, diff: 0 }]).goldDiffTimeline).toEqual([]);
  });
});
