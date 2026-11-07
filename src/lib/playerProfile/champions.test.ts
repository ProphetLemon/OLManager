import { describe, expect, it } from "vitest";
import type { PlayerMatchHistoryEntryData } from "@/store/gameStore";
import {
  buildChampionPerformanceMap,
  buildTopChampionMasteries,
} from "@/lib/playerProfile/champions";

describe("buildTopChampionMasteries", () => {
  const masteries = [
    { player_id: "p1", champion_id: "Ahri", mastery: 90 },
    { player_id: "p1", champion_id: "Zed", mastery: 70 },
    { player_id: "p1", champion_id: "Lux", mastery: 50 },
  ] as never;

  it("ranks by games played when match history exists", () => {
    const performance = new Map([
      ["Lux", { wr: 60, games: 8 }],
      ["Zed", { wr: 50, games: 2 }],
    ]);
    const result = buildTopChampionMasteries("p1", "MID", performance, masteries, 3);
    expect(result.map((c) => c.championId)).toEqual(["Lux", "Zed", "Ahri"]);
    expect(result.map((c) => c.rank)).toEqual(["insignia", 1, 2]);
  });

  it("keeps mastery order when there is no history", () => {
    const result = buildTopChampionMasteries("p1", "MID", new Map(), masteries, 3);
    expect(result.map((c) => c.championId)).toEqual(["Ahri", "Zed", "Lux"]);
  });

  it("limits the list to the visible champion count", () => {
    expect(buildTopChampionMasteries("p1", "MID", new Map(), masteries, 1)).toHaveLength(1);
    expect(buildTopChampionMasteries("p1", "MID", new Map(), masteries, 2)).toHaveLength(2);
  });

  it("ignores masteries that belong to other players", () => {
    const result = buildTopChampionMasteries(
      "p2",
      "MID",
      new Map(),
      [{ player_id: "p1", champion_id: "Ahri", mastery: 90 }] as never,
      4,
    );
    expect(result.map((c) => c.championId)).not.toContain("Ahri");
  });

  it("falls back to a role champion with default mastery when nothing is persisted", () => {
    const result = buildTopChampionMasteries("p9", "ADC", new Map(), [], 4);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rank: "insignia", mastery: 100 });
  });
});

describe("buildChampionPerformanceMap", () => {
  it("aggregates games and win rate per champion", () => {
    const history = [
      { championId: "Ahri", result: "Win" },
      { championId: "Ahri", result: "Loss" },
      { championId: "Ahri", result: "Win" },
      { championId: null, result: "Win" },
    ] as unknown as PlayerMatchHistoryEntryData[];
    expect(buildChampionPerformanceMap(history).get("Ahri")).toEqual({ games: 3, wr: 66.7 });
    expect(buildChampionPerformanceMap(history).size).toBe(1);
  });
});
