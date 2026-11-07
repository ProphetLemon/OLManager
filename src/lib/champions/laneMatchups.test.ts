// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  aggregateLaneMatchups,
  deriveCounterCandidates,
  findContradictions,
  roleDistribution,
  strengthForWinRate,
} from "../../../scripts/champions/lib/lane-matchups.mjs";

const game = (gameId: string, role: string, winner: string, loser: string) => [
  { gameId, role, champion: winner, win: true },
  { gameId, role, champion: loser, win: false },
];

describe("aggregateLaneMatchups", () => {
  it("emits both directions per lane game and keys by role", () => {
    const { matchups, laneGames } = aggregateLaneMatchups([
      ...game("g1", "Top", "Malphite", "Yasuo"),
      ...game("g2", "Top", "Yasuo", "Malphite"),
      ...game("g3", "Top", "Malphite", "Yasuo"),
      ...game("g3", "Mid", "Ahri", "Zed"),
    ]);
    expect(laneGames).toBe(4);
    const malphite = matchups.find((m) => m.role === "Top" && m.source === "malphite" && m.target === "yasuo");
    expect(malphite).toMatchObject({ games: 3, wins: 2 });
    const yasuo = matchups.find((m) => m.role === "Top" && m.source === "yasuo" && m.target === "malphite");
    expect(yasuo).toMatchObject({ games: 3, wins: 1 });
    expect(matchups.find((m) => m.role === "Mid" && m.source === "zed")).toMatchObject({ games: 1, wins: 0 });
  });

  it("skips slots that are not exactly one winner and one loser", () => {
    const { matchups, skipped } = aggregateLaneMatchups([
      { gameId: "g1", role: "Top", champion: "Aatrox", win: true },
      { gameId: "g2", role: "Top", champion: "Aatrox", win: true },
      { gameId: "g2", role: "Top", champion: "Gwen", win: true },
      ...game("g3", "Top", "Gwen", "Gwen"),
      { gameId: "g4", role: "Fill", champion: "Ahri", win: true },
    ]);
    expect(matchups).toEqual([]);
    expect(skipped).toBe(2);
  });

  it("normalises champion names and the Wukong alias", () => {
    const { matchups } = aggregateLaneMatchups(game("g1", "Jungle", "Wukong", "Lee Sin"));
    expect(matchups.map((m) => `${m.source}>${m.target}`)).toEqual(["leesin>monkeyking", "monkeyking>leesin"]);
  });
});

describe("deriveCounterCandidates", () => {
  const matchups = [
    { role: "Top", source: "a", target: "b", games: 20, wins: 13 }, // 65% -> 3
    { role: "Top", source: "b", target: "a", games: 20, wins: 7 },
    { role: "Mid", source: "c", target: "d", games: 11, wins: 10 }, // below sample
    { role: "Mid", source: "e", target: "f", games: 40, wins: 21 }, // 52.5% below threshold
    { role: "Bot", source: "g", target: "h", games: 12, wins: 7 }, // 58.3% at the sample minimum -> 1
  ];

  it("applies the minimum sample and win-rate threshold", () => {
    const out = deriveCounterCandidates(matchups);
    expect(out.map((c) => `${c.source}>${c.target}:${c.value}`)).toEqual(["a>b:3", "g>h:1"]);
  });

  it("keeps the role with the larger sample when a pair qualifies twice", () => {
    const out = deriveCounterCandidates([
      { role: "Top", source: "a", target: "b", games: 15, wins: 10 },
      { role: "Mid", source: "a", target: "b", games: 30, wins: 20 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("Mid");
  });

  it("maps win rate bands to curation values 1..5", () => {
    expect(strengthForWinRate(0.54)).toBeNull();
    expect([0.55, 0.6, 0.65, 0.72, 0.8].map((rate) => strengthForWinRate(rate))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("findContradictions", () => {
  it("flags curated counters whose reverse direction is supported by data", () => {
    const matchups = [
      { role: "Top", source: "yasuo", target: "malphite", games: 20, wins: 14 },
      { role: "Top", source: "malphite", target: "yasuo", games: 20, wins: 6 },
    ];
    const out = findContradictions(
      [
        { source: "malphite", target: "yasuo", value: 3 },
        { source: "garen", target: "teemo", value: 2 },
      ],
      matchups,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "malphite", target: "yasuo" });
    expect(out[0].against.winRate).toBeCloseTo(0.7);
  });
});

describe("roleDistribution", () => {
  it("counts picks per canonical role", () => {
    expect(
      roleDistribution([
        { gameId: "1", role: "Support", champion: "Heimerdinger", win: true },
        { gameId: "2", role: "Mid", champion: "Heimerdinger", win: false },
        { gameId: "3", role: "Mid", champion: "Heimerdinger", win: true },
      ]),
    ).toEqual({ heimerdinger: { Support: 1, Mid: 2 } });
  });
});

describe("pro-matchups cargo helpers", () => {
  it("builds a stable, paginated ScoreboardPlayers query and maps rows", async () => {
    const { scoreboardParams, rowsFromCargo } = await import("../../../scripts/champions/pro-matchups.mjs");
    const params = scoreboardParams({ since: "2025-01-01", until: "2027-01-01", offset: 500, pageSize: 500 });
    expect(params).toMatchObject({ action: "cargoquery", tables: "ScoreboardPlayers", order_by: "GameId,Role,PlayerWin", offset: "500", limit: "500" });
    expect(rowsFromCargo({ cargoquery: [{ title: { GameId: "g", Champion: "Ahri", Role: "Mid", PlayerWin: "Yes" } }] })).toEqual([
      { gameId: "g", champion: "Ahri", role: "Mid", win: true },
    ]);
    expect(rowsFromCargo({})).toEqual([]);
  });
});
