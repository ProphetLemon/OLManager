import { describe, expect, it } from "vitest";

import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import { buildDraftResultFromRuntime, buildLolMatchReport } from "./MatchSimulation";

function champion(id: string, team: "blue" | "red", damageDealt?: number) {
  return {
    id,
    name: id.toUpperCase(),
    team,
    role: "MID",
    kills: 1,
    deaths: 1,
    assists: 1,
    cs: 100,
    gold: 500,
    spentGold: 6000,
    ...(damageDealt === undefined ? {} : { damageDealt }),
  };
}

function runtime(champions: ReturnType<typeof champion>[]): LolSimV1RuntimeState {
  return {
    timeSec: 1500,
    running: false,
    winner: "blue",
    champions,
    stats: {
      blue: { kills: 5, towers: 6, dragons: 2, barons: 0, gold: 40000 },
      red: { kills: 3, towers: 1, dragons: 1, barons: 0, gold: 35000 },
    },
    events: [],
  } as unknown as LolSimV1RuntimeState;
}

const snapshot = {
  home_team: { id: "h", name: "Alpha", players: [] },
  away_team: { id: "a", name: "Beta", players: [] },
} as unknown as MatchSnapshot;

describe("damage in the match report the app receives", () => {
  it("sends each champion's damage dealt", () => {
    const report = buildLolMatchReport(runtime([champion("b1", "blue", 12345), champion("r1", "red", 9000)]));
    expect(report.champions.map((c) => c.damageDealt)).toEqual([12345, 9000]);
  });

  it("sends 0 for a champion whose state has no damage", () => {
    const report = buildLolMatchReport(runtime([champion("b1", "blue")]));
    expect(report.champions[0].damageDealt).toBe(0);
  });
});

describe("damage on the end screen result", () => {
  it("carries each champion's damage dealt into the player results", () => {
    const result = buildDraftResultFromRuntime({
      runtime: runtime([champion("b1", "blue", 12345), champion("r1", "red", 9000)]),
      snapshot,
      championSelections: null,
    });
    expect(result.playerResults.map((row) => row.damageDealt)).toEqual([12345, 9000]);
  });
});
