import { describe, expect, it } from "vitest";
import type { PlayerMatchHistoryEntryData } from "@/store/gameStore";
import { seasonTotalsFromHistory } from "./seasonTotals";

const entry = (over: Partial<PlayerMatchHistoryEntryData>): PlayerMatchHistoryEntryData =>
  ({
    fixtureId: "f",
    season: 3,
    result: "Win",
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    visionScore: 0,
    ...over,
  }) as PlayerMatchHistoryEntryData;

describe("seasonTotalsFromHistory", () => {
  it("sums wins, losses, KDA parts, CS and vision of the running season", () => {
    const history = [
      entry({ fixtureId: "a", result: "Win", kills: 5, deaths: 1, assists: 7, cs: 300, visionScore: 40 }),
      entry({ fixtureId: "b", result: "Loss", kills: 2, deaths: 4, assists: 3, cs: 250, visionScore: 30 }),
      entry({ fixtureId: "c", result: "Win", kills: 1, deaths: 0, assists: 9, cs: 280, visionScore: 50 }),
    ];
    expect(seasonTotalsFromHistory(history, 3, 3)).toEqual({
      wins: 2,
      losses: 1,
      kills: 8,
      deaths: 5,
      assists: 19,
      cs: 830,
      vision: 120,
    });
  });

  it("ignores matches of other seasons", () => {
    const history = [
      entry({ fixtureId: "a", season: 3, cs: 100 }),
      entry({ fixtureId: "old", season: 2, result: "Loss", cs: 999 }),
    ];
    expect(seasonTotalsFromHistory(history, 3, 1)).toMatchObject({ wins: 1, losses: 0, cs: 100 });
  });

  it("returns null when the history does not cover every appearance of the season", () => {
    const history = [entry({ fixtureId: "a" }), entry({ fixtureId: "b" })];
    expect(seasonTotalsFromHistory(history, 3, 5)).toBeNull();
  });

  it("returns null when no match of the season is recorded, instead of zeros", () => {
    expect(seasonTotalsFromHistory([], 3, 0)).toBeNull();
    expect(seasonTotalsFromHistory([entry({ season: 2 })], 3, 1)).toBeNull();
  });

  it("returns null when the season or the appearances are unknown", () => {
    const history = [entry({})];
    expect(seasonTotalsFromHistory(history, undefined, 1)).toBeNull();
    expect(seasonTotalsFromHistory(history, 3, undefined)).toBeNull();
  });
});
