// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CatalogueItem } from "../../../scripts/game-data/lib/ddragon-transform.mjs";
import {
  aggregatePairs,
  buildChampionEntries,
  canonicalRole,
  createChampionResolver,
  createItemResolver,
  decodeEntities,
  gamesByPatch,
  isFinishedItem,
  normalizeRows,
  parseItemNames,
  recommendBuild,
} from "../../../scripts/game-data/lib/pro-builds.mjs";
import { ORDER_BY, buildFile, buildsParams, fetchAllRows, parseArgs, rowsFromCargo } from "../../../scripts/game-data/pro-builds.mjs";

function item(key: string, overrides: Partial<CatalogueItem> = {}): CatalogueItem {
  return {
    id: 1,
    key,
    name: key,
    cost: 3000,
    baseCost: 1000,
    sellValue: 2000,
    stats: {},
    statLines: [],
    tags: [],
    buildsFrom: [1],
    buildsInto: [],
    depth: 2,
    boots: false,
    starter: false,
    consumable: false,
    trinket: false,
    support: false,
    icon: `/lol-item-icons/${key}.png`,
    ...overrides,
  };
}

const CATALOGUE: CatalogueItem[] = [
  item("infinity_edge"),
  item("bloodthirster"),
  item("rapid_firecannon"),
  item("phantom_dancer"),
  item("lord_dominiks_regards"),
  item("guardian_angel"),
  item("zekes_convergence"),
  item("berserkers_greaves", { boots: true }),
  item("plated_steelcaps", { boots: true }),
  item("long_sword", { buildsFrom: [], buildsInto: [2], cost: 350 }),
  item("dorans_blade", { starter: true, buildsFrom: [], cost: 450 }),
  item("control_ward", { consumable: true, buildsFrom: [] }),
  item("stealth_ward", { trinket: true, buildsFrom: [] }),
  item("bloodsong", { support: true, cost: 400 }),
  item("tear_of_the_goddess", { buildsInto: [3] }),
];

const resolveItem = createItemResolver(CATALOGUE);
const resolveChampion = createChampionResolver([
  { id: "Jinx", name: "Jinx" },
  { id: "MonkeyKing", name: "Wukong" },
  { id: "KSante", name: "K'Sante" },
]);

describe("parseItemNames and decodeEntities", () => {
  it("splits the semicolon list, drops empty slots and decodes Cargo entities", () => {
    expect(parseItemNames("Infinity Edge;Zeke&#039;s Convergence;; Berserker&#39;s Greaves ;")).toEqual([
      "Infinity Edge",
      "Zeke's Convergence",
      "Berserker's Greaves",
    ]);
    expect(parseItemNames("")).toEqual([]);
    expect(parseItemNames(undefined)).toEqual([]);
  });

  it("decodes named and numeric entities and ignores nonsense code points", () => {
    expect(decodeEntities("A &amp; B &quot;C&quot; &#x41;")).toBe('A & B "C" A');
    expect(decodeEntities("x&#99999999;y")).toBe("xy");
  });
});

describe("canonicalRole", () => {
  it("maps Leaguepedia roles and rejects the rest", () => {
    expect(canonicalRole("Bot")).toBe("Bot");
    expect(canonicalRole(" support ")).toBe("Support");
    expect(canonicalRole("Coach")).toBeNull();
    expect(canonicalRole(undefined)).toBeNull();
  });
});

describe("resolvers", () => {
  it("resolves champion names to Data Dragon ids, including Wukong and punctuation", () => {
    expect(resolveChampion("Wukong")).toBe("MonkeyKing");
    expect(resolveChampion("K'Sante")).toBe("KSante");
    expect(resolveChampion("Nobody")).toBeNull();
  });

  it("maps Leaguepedia item names to catalogue keys with the icon key style", () => {
    expect(resolveItem("Infinity Edge")?.key).toBe("infinity_edge");
    expect(resolveItem("Lord Dominik's Regards")?.key).toBe("lord_dominiks_regards");
    expect(resolveItem("Zeke's Convergence")?.key).toBe("zekes_convergence");
    expect(resolveItem("Removed Old Item")).toBeNull();
  });

  it("counts a transformed in-game form as the item that was bought", () => {
    const resolve = createItemResolver([...CATALOGUE, item("manamune"), item("archangels_staff")]);
    expect(resolve("Muramana")?.key).toBe("manamune");
    expect(resolve("Seraph's Embrace")?.key).toBe("archangels_staff");
    expect(resolve("Fimbulwinter")).toBeNull();
    expect(createItemResolver(CATALOGUE)("Muramana")).toBeNull();
  });
});

describe("isFinishedItem", () => {
  it("accepts completed recipes and rejects boots, components, consumables, trinkets, starters and the support quest line", () => {
    const finished = CATALOGUE.filter(isFinishedItem).map((entry) => entry.key);
    expect(finished).toEqual(["infinity_edge", "bloodthirster", "rapid_firecannon", "phantom_dancer", "lord_dominiks_regards", "guardian_angel", "zekes_convergence"]);
  });
});

const raw = (overrides: Record<string, unknown>) => ({
  gameId: "g1",
  champion: "Jinx",
  role: "Bot",
  win: true,
  items: ["Berserker's Greaves", "Infinity Edge", "Phantom Dancer", "Bloodthirster", "Control Ward"],
  patch: "16.22",
  date: "2026-11-01 10:00:00",
  ...overrides,
});

describe("normalizeRows", () => {
  it("splits items into boots, finished and other, and reports unmapped names with counts", () => {
    const result = normalizeRows(
      [raw({ items: ["Berserker's Greaves", "Infinity Edge", "Long Sword", "Mystery Blade", "Mystery Blade"] }), raw({ gameId: "g2", items: ["Mystery Blade"] })],
      { resolveChampion, resolveItem },
    );
    expect(result.rows[0]).toMatchObject({ champion: "Jinx", role: "Bot", boots: ["berserkers_greaves"], finished: ["infinity_edge"], other: ["long_sword"], hasItems: true });
    expect(result.unmappedItems).toEqual([{ name: "Mystery Blade", count: 3 }]);
  });

  it("drops rows with an unknown champion, a bad role or no result, and lists the unknown champions", () => {
    const result = normalizeRows(
      [raw({ champion: "Nobody" }), raw({ role: "Coach" }), raw({ win: null }), raw({ gameId: null }), raw({ champion: "Wukong", role: "Jungle" })],
      { resolveChampion, resolveItem },
    );
    expect(result.rows.map((row) => row.champion)).toEqual(["MonkeyKing"]);
    expect(result.droppedRows).toBe(4);
    expect(result.unresolvedChampions).toEqual([{ name: "Nobody", count: 1 }]);
  });

  it("marks a row without any item names as having no item data", () => {
    const result = normalizeRows([raw({ items: [] })], { resolveChampion, resolveItem });
    expect(result.rows[0].hasItems).toBe(false);
  });
});

/** `games` identical rows of one champion and role, with the given finished items and boots. */
function games(count: number, finished: string[], boots: string[] = ["berserkers_greaves"], extra: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    gameId: `${extra.champion ?? "Jinx"}-${extra.role ?? "Bot"}-${finished.join("")}-${index}`,
    champion: "Jinx",
    role: "Bot",
    win: index % 2 === 0,
    patch: "16.22",
    date: "2026-11-01 10:00:00",
    boots,
    finished: [...finished].sort(),
    other: [],
    hasItems: true,
    ...extra,
  }));
}

describe("aggregatePairs", () => {
  it("counts games, wins and games with item data, and each item once per game", () => {
    const rows = [...games(3, ["infinity_edge", "phantom_dancer"]), ...games(1, ["infinity_edge"], []), { ...games(1, [])[0], gameId: "empty", hasItems: false, win: true }];
    const [pair] = aggregatePairs(rows);
    expect(pair).toMatchObject({ champion: "Jinx", role: "Bot", games: 5, wins: 4, buildGames: 4 });
    expect(pair.items.get("infinity_edge")).toBe(4);
    expect(pair.items.get("phantom_dancer")).toBe(3);
    expect(pair.boots.get("berserkers_greaves")).toBe(3);
  });

  it("keeps champion and role pairs apart and orders them", () => {
    const rows = [...games(1, ["infinity_edge"], [], { champion: "MonkeyKing", role: "Jungle" }), ...games(1, ["infinity_edge"], [], { role: "Mid" }), ...games(1, ["infinity_edge"])];
    expect(aggregatePairs(rows).map((pair) => `${pair.champion}/${pair.role}`)).toEqual(["Jinx/Bot", "Jinx/Mid", "MonkeyKing/Jungle"]);
  });

  it("counts the three-item cores of each game", () => {
    const [pair] = aggregatePairs(games(2, ["bloodthirster", "infinity_edge", "phantom_dancer", "rapid_firecannon"]));
    expect(pair.cores.get("bloodthirster+infinity_edge+phantom_dancer")).toBe(2);
    expect(pair.cores.size).toBe(4);
  });
});

describe("recommendBuild", () => {
  const sample = (builds: Array<[number, string[]]>) => aggregatePairs(builds.flatMap(([count, finished], index) => games(count, finished, ["berserkers_greaves"], { champion: "Jinx", role: "Bot", gameId: undefined, tag: index }).map((row, n) => ({ ...row, gameId: `b${index}-${n}` }))))[0];

  it("takes the most frequent boots and the five most frequent finished items, most frequent first", () => {
    const pair = sample([
      [10, ["infinity_edge", "phantom_dancer", "bloodthirster", "rapid_firecannon", "guardian_angel"]],
      [10, ["infinity_edge", "phantom_dancer", "bloodthirster", "lord_dominiks_regards", "zekes_convergence"]],
      [5, ["infinity_edge", "phantom_dancer", "lord_dominiks_regards"]],
    ]);
    expect(recommendBuild(pair, { minGames: 20 })).toEqual({
      boots: "berserkers_greaves",
      items: ["infinity_edge", "phantom_dancer", "bloodthirster", "lord_dominiks_regards", "guardian_angel"],
    });
  });

  it("breaks ties by item key so the file is stable", () => {
    const pair = sample([[20, ["rapid_firecannon", "infinity_edge", "bloodthirster"]]]);
    expect(recommendBuild(pair)?.items).toEqual(["bloodthirster", "infinity_edge", "rapid_firecannon"]);
  });

  it("returns null under the minimum sample, and at exactly the minimum returns a build", () => {
    expect(recommendBuild(sample([[19, ["infinity_edge", "phantom_dancer", "bloodthirster"]]]), { minGames: 20 })).toBeNull();
    expect(recommendBuild(sample([[20, ["infinity_edge", "phantom_dancer", "bloodthirster"]]]), { minGames: 20 })).not.toBeNull();
  });

  it("returns null when fewer than three finished items were ever seen", () => {
    expect(recommendBuild(sample([[30, ["infinity_edge", "phantom_dancer"]]]))).toBeNull();
  });

  it("does not count games without item data toward the minimum", () => {
    const rows = [...games(15, ["infinity_edge", "phantom_dancer", "bloodthirster"]), ...games(10, [], [], { hasItems: false, gameId: undefined }).map((row, n) => ({ ...row, gameId: `x${n}` }))];
    const [pair] = aggregatePairs(rows);
    expect(pair.games).toBe(25);
    expect(recommendBuild(pair)).toBeNull();
  });
});

describe("buildChampionEntries", () => {
  const rows = [
    ...games(25, ["infinity_edge", "phantom_dancer", "bloodthirster", "rapid_firecannon", "guardian_angel"]),
    ...games(4, ["infinity_edge", "phantom_dancer", "bloodthirster"], ["plated_steelcaps"], { champion: "MonkeyKing", role: "Jungle" }),
  ];
  const { champions, pairs } = buildChampionEntries(aggregatePairs(rows), { classOf: (id) => (id === "MonkeyKing" ? "Fighter" : "Marksman") });

  it("gives a pair with enough games a build with shares, boots shares and cores", () => {
    const entry = champions.Jinx.Bot;
    expect(entry).toMatchObject({ games: 25, wins: 13, buildGames: 25 });
    expect(entry.build).toEqual({ boots: "berserkers_greaves", items: ["bloodthirster", "guardian_angel", "infinity_edge", "phantom_dancer", "rapid_firecannon"] });
    expect(entry.itemShare?.infinity_edge).toBe(1);
    expect(entry.bootsShare).toEqual({ berserkers_greaves: 1 });
    expect(entry.commonCores?.[0]).toEqual({ items: ["bloodthirster", "guardian_angel", "infinity_edge"], games: 25 });
    expect(entry.fallback).toBeUndefined();
  });

  it("marks a pair under the minimum as falling back on its class, keeping games and wins as presence", () => {
    expect(champions.MonkeyKing.Jungle).toEqual({ games: 4, wins: 2, buildGames: 4, build: null, fallback: "class", class: "Fighter" });
  });

  it("counts pairs with and without a build", () => {
    expect(pairs).toEqual({ total: 2, withBuild: 1, fallback: 1 });
  });
});

describe("gamesByPatch", () => {
  it("counts distinct games per patch in numeric patch order", () => {
    const rows = [...games(2, [], [], { patch: "16.9" }), ...games(1, [], [], { patch: "16.10", gameId: "z" }), ...games(1, [], [], { patch: null, gameId: "y" })];
    expect(gamesByPatch(rows)).toEqual({ "16.9": 2, "16.10": 1, unknown: 1 });
  });
});

describe("Cargo query and parsing", () => {
  it("builds a paged query over the date window with a total order and the Items and Patch fields", () => {
    const params = buildsParams({ since: "2025-11-12", until: "2026-11-12", offset: 1000, pageSize: 500 });
    expect(params).toMatchObject({ action: "cargoquery", tables: "ScoreboardPlayers=SP,ScoreboardGames=SG", join_on: "SP.GameId=SG.GameId", order_by: ORDER_BY, limit: "500", offset: "1000" });
    expect(params.fields).toContain("SP.Items=Items");
    expect(params.fields).toContain("SG.Patch=Patch");
    expect(params.where).toBe("SP.DateTime_UTC >= '2025-11-12' AND SP.DateTime_UTC < '2026-11-12'");
  });

  it("refuses a window that could smuggle anything into the WHERE clause", () => {
    expect(() => buildsParams({ since: "2025-01-01' OR 1=1 --", until: "2026-01-01", offset: 0, pageSize: 500 })).toThrow(/invalid window/);
    expect(() => buildsParams({ since: "2026-01-02", until: "2026-01-01", offset: 0, pageSize: 500 })).toThrow(/invalid window/);
  });

  it("parses rows: results, item names and empty values", () => {
    const rows = rowsFromCargo({
      cargoquery: [
        { title: { GameId: "g1", Champion: "Jinx", Role: "Bot", PlayerWin: "Yes", Items: "Infinity Edge;Zeke&#039;s Convergence", Patch: "16.22", DateTimeUtc: "2026-11-01 10:00:00" } },
        { title: { GameId: "g2", Champion: "", Role: "Bot", PlayerWin: "", Items: "", Patch: "", DateTimeUtc: "" } },
      ],
    });
    expect(rows[0]).toEqual({ gameId: "g1", champion: "Jinx", role: "Bot", win: true, items: ["Infinity Edge", "Zeke's Convergence"], patch: "16.22", date: "2026-11-01 10:00:00" });
    expect(rows[1]).toMatchObject({ champion: null, win: null, items: [], patch: null });
    expect(() => rowsFromCargo({})).toThrow(/cargoquery/);
  });

  it("pages until a short page, never asking for more than the Cargo maximum", async () => {
    const calls: Record<string, string>[] = [];
    const total = 1203;
    const client = {
      async get(params: Record<string, string>) {
        calls.push(params);
        const offset = Number(params.offset);
        const size = Math.min(Number(params.limit), Math.max(0, total - offset));
        return { cargoquery: Array.from({ length: size }, (_, index) => ({ title: { GameId: `g${offset + index}`, Champion: "Jinx", Role: "Bot", PlayerWin: "Yes", Items: "" } })) };
      },
    };
    const rows = await fetchAllRows(client, { since: "2026-01-01", until: "2026-02-01", pageSize: 5000 });
    expect(rows).toHaveLength(total);
    expect(calls.map((call) => call.limit)).toEqual(["500", "500", "500"]);
  });
});

describe("parseArgs", () => {
  it("is anonymous unless --login is given, and rejects unknown flags", () => {
    expect(parseArgs([]).login).toBe(false);
    expect(parseArgs(["--login"]).login).toBe(true);
    expect(() => parseArgs(["--password"])).toThrow(/unknown flag/);
    expect(parseArgs(["--since", "2025-11-12", "--until", "2026-11-12", "--offline"])).toMatchObject({ since: "2025-11-12", until: "2026-11-12", offline: true, minGames: 20 });
  });
});

describe("buildFile", () => {
  const kits = {
    Jinx: { id: "Jinx", name: "Jinx", tags: ["Marksman"] },
    MonkeyKing: { id: "MonkeyKing", name: "Wukong", tags: ["Fighter", "Tank"] },
    Ahri: { id: "Ahri", name: "Ahri", tags: ["Mage"] },
  };
  const rawRows = [
    ...Array.from({ length: 22 }, (_, index) => raw({ gameId: `a${index}`, win: index % 3 === 0, items: ["Berserker's Greaves", "Infinity Edge", "Phantom Dancer", "Bloodthirster", "Control Ward"] })),
    raw({ gameId: "b1", champion: "Wukong", role: "Jungle", items: ["Plated Steelcaps", "Old Removed Item"] }),
  ];
  const file = buildFile({
    rawRows,
    items: CATALOGUE,
    kits,
    catalogueIds: ["Jinx", "MonkeyKing", "Ahri"],
    args: { since: "2025-11-12", until: "2026-11-12", minGames: 20 },
    pulledAt: "2026-11-11",
    patch: "16.22.1",
  });

  it("records its provenance", () => {
    expect(file).toMatchObject({
      schema: "olm.champion-builds.v1",
      date: "2026-11-11",
      itemsPatch: "16.22.1",
      since: "2025-11-12",
      until: "2026-11-12",
      firstGame: "2026-11-01 10:00:00",
      patches: { "16.22": 23 },
      games: 23,
      minGames: 20,
      pairs: { total: 2, withBuild: 1, fallback: 1 },
    });
    expect(String(file.source)).toContain("Leaguepedia");
    expect(String(file.leagues)).toContain("no league filter");
  });

  it("lists unmapped item names, and catalogue champions never seen", () => {
    expect(file.unmappedItems).toEqual([{ name: "Old Removed Item", count: 1 }]);
    expect(file.championsWithoutGames).toEqual(["Ahri"]);
  });

  it("only names catalogue item keys in builds, shares and cores", () => {
    const keys = new Set(CATALOGUE.map((entry) => entry.key));
    const entry = file.champions.Jinx.Bot as { build: { boots: string; items: string[] }; itemShare: Record<string, number> };
    for (const key of [entry.build.boots, ...entry.build.items, ...Object.keys(entry.itemShare)]) expect(keys.has(key)).toBe(true);
    expect(file.champions.MonkeyKing.Jungle).toMatchObject({ fallback: "class", class: "Fighter" });
  });
});
