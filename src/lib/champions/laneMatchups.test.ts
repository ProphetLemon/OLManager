// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  aggregateLaneMatchups,
  deriveCounterCandidates,
  findContradictions,
  roleDistribution,
  createChampionResolver,
  strengthForLowerBound,
  wilsonLowerBound,
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
    { role: "Top", source: "a", target: "b", games: 40, wins: 29 }, // 72.5%, lower bound 0.57 -> 3
    { role: "Top", source: "b", target: "a", games: 40, wins: 11 },
    { role: "Mid", source: "c", target: "d", games: 19, wins: 18 }, // below sample
    { role: "Mid", source: "e", target: "f", games: 40, wins: 22 }, // 55% but lower bound 0.40
    { role: "Bot", source: "g", target: "h", games: 12, wins: 7 }, // 58% of a dozen games is noise
    { role: "Bot", source: "i", target: "j", games: 12, wins: 10 }, // a small sample cannot reach a high band
  ];

  it("gates on the Wilson lower bound and the minimum sample", () => {
    const out = deriveCounterCandidates(matchups);
    expect(out.map((c) => `${c.source}>${c.target}:${c.value}`)).toEqual(["a>b:3"]);
    expect(out[0].lowerBound).toBeCloseTo(wilsonLowerBound(29, 40));
  });

  it("keeps the role with the larger sample when a pair qualifies twice", () => {
    const out = deriveCounterCandidates([
      { role: "Top", source: "a", target: "b", games: 30, wins: 24 },
      { role: "Mid", source: "a", target: "b", games: 60, wins: 45 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("Mid");
  });

  it("bases the value on the lower bound, not the raw win rate", () => {
    expect(wilsonLowerBound(7, 12)).toBeLessThan(0.5);
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(strengthForLowerBound(0.49)).toBeNull();
    expect([0.5, 0.52, 0.55, 0.6, 0.7].map((bound) => strengthForLowerBound(bound))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("createChampionResolver", () => {
  const resolve = createChampionResolver([
    { id: "Nunu", name: "Nunu & Willump" },
    { id: "Renata", name: "Renata Glasc" },
    { id: "MonkeyKing", name: "Wukong" },
    { id: "Ahri", name: "Ahri" },
  ]);

  it("maps Leaguepedia names to game ids", () => {
    expect(resolve("Nunu & Willump")).toBe("nunu");
    expect(resolve("Renata Glasc")).toBe("renata");
    expect(resolve("Wukong")).toBe("monkeyking");
    expect(resolve("Ahri")).toBe("ahri");
    expect(resolve("Nunu")).toBe("nunu");
  });

  it("returns null for a name that does not resolve", () => {
    expect(resolve("Not A Champion")).toBeNull();
  });
});

describe("findContradictions", () => {
  it("flags curated counters whose reverse direction is supported by data", () => {
    const matchups = [
      { role: "Top", source: "yasuo", target: "malphite", games: 40, wins: 29 },
      { role: "Top", source: "malphite", target: "yasuo", games: 40, wins: 11 },
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
    expect(out[0].against.winRate).toBeCloseTo(0.725);
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
