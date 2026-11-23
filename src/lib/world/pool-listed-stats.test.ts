// @vitest-environment node
// The people of the listed events (pool-events.mjs) are rated from their stats, compared with one another: one pooled cohort per role, the
// pool's tier baseline as the anchor. The stat lines are synthetic (the research folders hold no per-game stats); the links, dates, roles and
// game ids of the renamed player's 26 games are the real ones (women-scene-2026-11-23, s2.json), under "Vicky", "Indiff" and "Indifferent".
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MediaWikiClient } from "../../../scripts/world/lib/mediawiki-client.mjs";
import { runRefresh } from "../../../scripts/world/lib/pipeline.mjs";
import { fetchPoolInputs, type PoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import { LISTED_COMPETITION, RATING_STATS, RATING_TIER_DEFAULT, ratePoolPlayer } from "../../../scripts/world/lib/pool-rating.mjs";
import { personFromRow } from "../../../scripts/world/lib/pool-scope.mjs";
import { FIXTURES } from "./fixtures";
import { baselines, read, root, row, stubClient, tournamentRows, type Row } from "./poolFixtures";

const womenRows = read<Row[]>(path.join(root, "scripts/world/fixtures/pool-women/tournaments.json"));
const vickyGames = read<Array<{ link: string; gameId: string; date: string; role: string }>>(path.join(root, "scripts/world/fixtures/pool-women/vicky-games.json"));

type Stat = Record<string, unknown>;
const line = (playerKey: string, role: string, date: string, skill: number, p: number, g: number, competition: string = LISTED_COMPETITION): Stat => ({
  playerKey, competition, role, date, gameMinutes: 30 + (g % 4), kills: 3 + skill + (p % 3), deaths: 3 - (skill > 0 ? 2 : 0) + (p % 3), assists: 5 + (p % 4), teamKills: 18,
  damageToChampions: 16000 + 2500 * skill + p * 100, teamDamageToChampions: 70000, gold: 11000 + 800 * skill + p * 20, teamGold: 60000, cs: 300 + 25 * skill + p, visionScore: null,
});
/** `count` other Support players with `games` games each, in the pooled group. */
const fillers = (count: number, games = 12, role = "Support") => Array.from({ length: count }, (_, p) => Array.from({ length: games }, (_, g) => line(`${role} Filler ${p}`, role, `2025-0${1 + (g % 9)}-1${g % 9}`, 0, p, g))).flat();
const vickyRows = vickyGames.map((game, g) => line(game.link, game.role, game.date, 3, 1, g));
const targets = new Map([["Indiff", "Vicky"], ["Indifferent", "Vicky"]]);
/** What fetchPoolInputs reports when the listed events' scoreboard was read. */
const READ = { requested: true, read: true, pages: 3, inputRows: 0, rows: 0, dropped: {} };
const vickyPerson = () => personFromRow(row({
  player: "Vicky", ign: "Vicky", name: "Victoria de la Torre Serna", country: "Spain", birth: "1998-11-03", prole: "Support", rmin: "Support", rmax: "Support", n: "5", last: "2026-11-14",
  lmin: "", tmin: "Secondary", toff: "0", loff: "", tours: "Equal Esports Cup 2024/League Phase|Storm Takeover 2024",
}));

describe("the listed events' own stats", () => {
  let inputs: PoolInputs;
  const withVicky = (extra: object = {}) => ({
    ...inputs, people: new Map([...inputs.people, ["Vicky", vickyPerson()]]), aliases: { ...inputs.aliases, targets }, listedStats: READ, ...extra,
  });
  const run = (pool: object) =>
    runRefresh({
      dataDir: FIXTURES.dataDir, teamMapPath: FIXTURES.teamMap, idMapPath: FIXTURES.idMap, client: new MediaWikiClient({ cacheDir: FIXTURES.cacheDir, offline: true }),
      asOf: "2026-11-07", pool: pool as never,
    });
  const op = (result: Awaited<ReturnType<typeof run>>, page: string) => (result.overlay.players as Array<Record<string, any>>).find((o) => o.op === "add" && o.pool?.page === page)!;
  beforeAll(async () => {
    inputs = await fetchPoolInputs({ client: stubClient({ tournaments: [...tournamentRows, ...womenRows] }) });
  });

  it("rates the renamed player from all 25 Support games under the three names, anchored to the pool's tier baseline", async () => {
    const result = await run({ inputs: withVicky({ listedRows: [...vickyRows, ...fillers(15)] }) });
    expect(op(result, "Vicky").pool).toMatchObject({ rating: RATING_STATS, rating_games: 25, rating_competition: LISTED_COMPETITION, tier: 3 });
    const plain = await run({ inputs: withVicky({ listedRows: [] }) });
    expect(op(plain, "Vicky").pool.rating).toBe(RATING_TIER_DEFAULT);
    expect(op(result, "Vicky").player.attributes).not.toEqual(op(plain, "Vicky").player.attributes);
  });

  it("reads the old names only through the alias map: without it the player has too few games under any one name", async () => {
    const result = await run({ inputs: withVicky({ listedRows: [...vickyRows, ...fillers(15)], aliases: { ...inputs.aliases, targets: new Map() } }) });
    expect(op(result, "Vicky").pool.rating).toBe(RATING_TIER_DEFAULT);
  });

  it("changes the rating by exactly 6 points from the tier baseline at the cap, either way", () => {
    const rate = (z: number | null) => ratePoolPlayer({ tier: 3, position: "Support", baselines, estimate: z === null ? null : { playerKey: "x", competition: LISTED_COMPETITION, role: "Support", games: 20, z, rho: 0.9 } as never });
    const base = rate(null);
    expect(rate(10).ovr - base.ovr).toBe(6);
    expect(rate(-10).ovr - base.ovr).toBe(-6);
    expect(rate(10)).toMatchObject({ source: RATING_STATS, competition: LISTED_COMPETITION });
  });

  it("with the game's league ladder the pooled stats still count, and the ladder never gets a listed level", async () => {
    const anchors = {
      levels: { ga: { median: 70, sd: 4 } }, prefixes: {}, leagueDefault: {}, tierDefault: { 1: { median: 70, n: 20 }, 2: { median: 60, n: 20 } }, tierOf: {},
    };
    const before = JSON.stringify(anchors);
    const result = await run({ inputs: withVicky({ listedRows: [...vickyRows, ...fillers(15)] }), statsRows: [], anchors });
    expect(op(result, "Vicky").pool).toMatchObject({ rating: RATING_STATS, rating_competition: LISTED_COMPETITION });
    expect(JSON.stringify(anchors)).toBe(before);
    expect(ratePoolPlayer({ tier: 3, position: "Support", baselines, anchors, estimate: { playerKey: "x", competition: "nowhere", role: "Support", games: 20, z: 1, rho: 0.5 } as never }).source).not.toBe(RATING_STATS);
  });

  /** The pool's Top players, one of whom (the first) also played a listed event; plus game-competition rows for them and 15 fillers. */
  const topsSetup = async (gameGames: number) => {
    const plain = await run({ inputs });
    const tops = plain.pool!.selection.players.filter((e) => e.role === "Top").map((e) => e.page);
    const gamePages = [...tops, ...Array.from({ length: 15 }, (_, i) => `Game Filler ${i}`)];
    const gameRows = gamePages.flatMap((page, p) => Array.from({ length: page === tops[0] ? gameGames : 12 }, (_, g) => line(page, "Top", `2026-0${1 + (g % 9)}-1${g % 9}`, page === tops[0] ? 4 : 0, p, g, "lec")));
    const person = inputs.people.get(tops[0])!;
    const listedEvent = { ...inputs, listedStats: READ, people: new Map([...inputs.people, [tops[0], { ...person, tournaments: [...(person.tournaments ?? []), "Equal Esports Cup 2024/League Phase"] }]]) };
    const listedFor = (page: string, games: number, skill = -4) => Array.from({ length: games }, (_, g) => line(page, "Top", `2025-0${1 + (g % 9)}-1${g % 9}`, skill, 2, g));
    return { tops, gameRows, listedEvent, listedFor };
  };

  it("keeps the game path, byte for byte, for a person the game's competitions rate from stats", async () => {
    const { tops, gameRows, listedEvent, listedFor } = await topsSetup(12);
    const without = await run({ inputs: listedEvent, statsRows: gameRows });
    const withListed = await run({ inputs: { ...listedEvent, listedRows: [...listedFor(tops[0], 12), ...fillers(15, 12, "Top")] }, statsRows: gameRows });
    expect(op(withListed, tops[0])).toEqual(op(without, tops[0]));
    expect(op(withListed, tops[0]).pool.rating).toBe(RATING_STATS);
  });

  it("uses the pooled stats for a person the game's competitions only give the default (under 8 games there)", async () => {
    const { tops, gameRows, listedEvent, listedFor } = await topsSetup(5);
    const without = await run({ inputs: listedEvent, statsRows: gameRows });
    expect(op(without, tops[0]).pool.rating).toBe(RATING_TIER_DEFAULT);
    const withListed = await run({ inputs: { ...listedEvent, listedRows: [...listedFor(tops[0], 12), ...fillers(15, 12, "Top")] }, statsRows: gameRows });
    expect(op(withListed, tops[0]).pool).toMatchObject({ rating: RATING_STATS, rating_competition: LISTED_COMPETITION, rating_games: 12 });
  });

  it("also uses them when the ladder has no level for the game competition the person played in", async () => {
    const { tops, gameRows, listedEvent, listedFor } = await topsSetup(12);
    const anchors = { levels: { ga: { median: 70, sd: 4 } }, prefixes: {}, leagueDefault: {}, tierDefault: { 1: { median: 70, n: 20 }, 2: { median: 60, n: 20 } }, tierOf: {} };
    const withListed = await run({ inputs: { ...listedEvent, listedRows: [...listedFor(tops[0], 12), ...fillers(15, 12, "Top")] }, statsRows: gameRows, anchors });
    expect(op(withListed, tops[0]).pool).toMatchObject({ rating: RATING_STATS, rating_competition: LISTED_COMPETITION });
  });

  it("leaves a pool person outside the listed events as they were, even when the pooled rows carry their games", async () => {
    const { tops, listedEvent, listedFor } = await topsSetup(12);
    const other = tops[1];
    const without = await run({ inputs: listedEvent });
    const withListed = await run({ inputs: { ...listedEvent, listedRows: [...listedFor(other, 12, 4), ...fillers(15, 12, "Top")] } });
    expect(op(withListed, other)).toEqual(op(without, other));
    expect(op(withListed, other).pool.rating).toBe(RATING_TIER_DEFAULT);
  });

  it("gives a person with too few pooled games exactly the result they get with no listed rows at all", async () => {
    const { tops, gameRows, listedEvent, listedFor } = await topsSetup(5);
    const without = await run({ inputs: listedEvent, statsRows: gameRows });
    const withListed = await run({ inputs: { ...listedEvent, listedRows: [...listedFor(tops[0], 7), ...fillers(15, 12, "Top")] }, statsRows: gameRows });
    expect(op(withListed, tops[0])).toEqual(op(without, tops[0]));
  });

  it("leaves a person with fewer than 8 games in the pooled rows on the default", async () => {
    const few = vickyRows.slice(0, 7).map((r) => ({ ...r, playerKey: "Vicky", role: "Support" }));
    const result = await run({ inputs: withVicky({ listedRows: [...few, ...fillers(15)] }) });
    expect(op(result, "Vicky").pool.rating).toBe(RATING_TIER_DEFAULT);
  });

  it("keeps the default when a role's group is too small, and the run says so", async () => {
    const result = await run({ inputs: withVicky({ listedRows: [...vickyRows, ...fillers(5)] }) });
    expect(op(result, "Vicky").pool.rating).toBe(RATING_TIER_DEFAULT);
    expect(result.warnings.join("\n")).toContain("Support");
    expect(result.warnings.join("\n")).toMatch(/group.*too small/i);
  });

  it("changes nobody else: every other add, the staff and the roster operations are as they were", async () => {
    const without = await run({ inputs: withVicky({ listedRows: [] }) });
    const rated = await run({ inputs: withVicky({ listedRows: [...vickyRows, ...fillers(15)] }) });
    const rest = (r: typeof rated) => (r.overlay.players as Array<Record<string, any>>).filter((o) => o.pool?.page !== "Vicky");
    expect(rest(rated)).toEqual(rest(without));
    expect(rated.overlay.staff).toEqual(without.overlay.staff);
    expect((rated.overlay.players as Array<Record<string, any>>).filter((o) => !o.pool)).toEqual((without.overlay.players as Array<Record<string, any>>).filter((o) => !o.pool));
  });

  it("states in the report who was rated from the pooled stats and who kept the default, and why, by role", async () => {
    const result = await run({ inputs: withVicky({ listedRows: [...vickyRows, ...fillers(15)] }) });
    expect(result.report).toContain("### Listed events: pooled stats");
    expect(result.report).toMatch(/\| Support \| 1 \| 0 \| 0 \| 0 \|/);
    const small = await run({ inputs: withVicky({ listedRows: [...vickyRows, ...fillers(5)] }) });
    expect(small.report).toMatch(/\| Support \| 0 \| 0 \| 0 \| 1 \|/);
    const none = await run({ inputs: withVicky({ listedRows: [] }) });
    expect(none.report).toMatch(/\| Support \| 0 \| 0 \| 1 \| 0 \|/);
  });

  it("says the stats were not read, instead of counting everybody as lacking data, when the run had no --pool-stats", async () => {
    const notRead = await run({ inputs: withVicky({ listedRows: [], listedStats: { ...READ, requested: false, read: false } }) });
    expect(notRead.report).toContain("### Listed events: pooled stats");
    expect(notRead.report).toContain("not read");
    expect(notRead.report).not.toMatch(/\| Support \| 0 \| 0 \| 1 \| 0 \|/);
  });

  it("tells rows that were read and dropped from rows that were never there", async () => {
    const dropped = { "team damage incomplete": 20 };
    const result = await run({ inputs: withVicky({ listedRows: [], listedStats: { ...READ, inputRows: 20, rows: 0, dropped } }) });
    expect(result.report).toContain("20 of 20 scoreboard rows were dropped");
    expect(result.report).toContain("team damage incomplete: 20");
  });

  it("lists every old name that was followed with its roster entries, games counted and stats rows folded, the game competitions' included", async () => {
    const followed = [{ name: "Indiff", page: "Vicky", entries: 2, games: 17, rows: 17 }, { name: "Only In Stats", page: "Vicky", entries: 0, games: 0, rows: 0 }];
    const statsRows = Array.from({ length: 3 }, (_, g) => line("Only In Stats", "Support", `2026-01-0${g + 1}`, 0, 1, g, "lec"));
    const result = await run({
      inputs: withVicky({ listedRows: [...vickyRows, ...fillers(15)], aliases: { ...inputs.aliases, targets: new Map([...targets, ["Only In Stats", "Vicky"]]), followed } }), statsRows,
    });
    expect(result.report).toContain("### Old names followed");
    expect(result.report).toMatch(/\| Indiff \| Vicky \| 2 \| 17 \| 17 \|/);
    expect(result.report).toMatch(/\| Only In Stats \| Vicky \| 0 \| 0 \| 3 \|/);
  });
});

describe("reading the listed events' scoreboard", () => {
  // One complete game of the Storm Takeover 2024 page: two teams of five with a damage column.
  const roles = ["Top", "Jungle", "Mid", "Bot", "Support"];
  const game = (gameId: string, overviewPage: string, dateTime: string): Row[] =>
    ["Blue", "Red"].flatMap((team, side) => roles.map((role, i) => ({
      OverviewPage: overviewPage, GameId: gameId, Link: `${team} ${role}`, Name: `${team} ${role}`, Team: team, Role: role, Side: String(side + 1), Kills: "3", Deaths: "2", Assists: "5",
      Gold: "11000", CS: "300", DamageToChampions: String(15000 + i * 100), VisionScore: "20", TeamKills: "15", TeamGold: "55000", DateTimeUtc: dateTime, GameMinutes: "32",
    })));
  const scoreboard = (client: ReturnType<typeof stubClient>) => client.calls.filter((c) => c.tables === "ScoreboardPlayers=SP,ScoreboardGames=SG");

  it("asks for the listed events' tournaments only, from their own date, and normalizes the rows into one pooled group", async () => {
    const client = stubClient({ tournaments: womenRows, listedGames: game("Storm Takeover 2024_1", "Storm Takeover 2024", "2024-06-08 11:04:00") });
    const found = await fetchPoolInputs({ client, listedGames: true });
    const calls = scoreboard(client);
    expect(calls.length).toBeGreaterThan(0);
    const where = calls.map((c) => c.where).join("\n");
    expect(where).toContain('"Storm Takeover 2024"');
    expect(where).toContain('"Equal Esports Cup 2024/League Phase"');
    expect(where).not.toContain("Our Party 23-24");
    for (const c of calls) expect(c.where).toContain('SP.DateTime_UTC >= "2023-06-01 00:00:00"');
    expect(found.listedRows).toHaveLength(10);
    expect(found.listedRows.every((r: { competition: string }) => r.competition === LISTED_COMPETITION)).toBe(true);
  });

  it("is not asked for without --pool-stats, and an explicit --pool-since is its limit", async () => {
    const plain = stubClient({ tournaments: womenRows });
    const none = await fetchPoolInputs({ client: plain });
    expect(scoreboard(plain)).toHaveLength(0);
    expect(none.listedRows).toEqual([]);
    const explicit = stubClient({ tournaments: womenRows });
    await fetchPoolInputs({ client: explicit, since: "2025-01-01", listedFrom: "2025-01-01", listedGames: true });
    for (const c of scoreboard(explicit)) expect(c.where).toContain('SP.DateTime_UTC >= "2025-01-01 00:00:00"');
  });

  it("yields no rows for an event with no game-level data, and warns instead of failing when the read is unavailable", async () => {
    const empty = await fetchPoolInputs({ client: stubClient({ tournaments: womenRows, listedGames: [] }), listedGames: true });
    expect(empty.listedRows).toEqual([]);
    const failing = await fetchPoolInputs({ client: stubClient({ tournaments: womenRows, failListedGames: true }), listedGames: true });
    expect(failing.listedRows).toEqual([]);
    expect(failing.warnings.some((w: string) => w.includes("listed events"))).toBe(true);
  });

  it("writes page names the way the pool's other queries do: an apostrophe and an accented letter pass through, a double quote is escaped", async () => {
    const storm = womenRows.find((r) => r.OverviewPage === "Storm Takeover 2024")!;
    const odd = [
      { ...storm, OverviewPage: "Storm Takeover 2024/Women's Open Qualifier", Name: "Women's Open" },
      { ...storm, OverviewPage: "Coupe des Étoiles 2024/Finale", Name: "Finale", League: "Coupe des Étoiles" },
      { ...storm, OverviewPage: 'Storm Takeover 2024/The "Big" Final', Name: "Big" },
    ];
    const client = stubClient({ tournaments: [...womenRows, ...odd], listedGames: [] });
    await fetchPoolInputs({ client, listedGames: true });
    const where = scoreboard(client).map((c) => c.where).join("\n");
    expect(where).toContain(`"Storm Takeover 2024/Women's Open Qualifier"`);
    expect(where).toContain('"Coupe des Étoiles 2024/Finale"');
    expect(where).toContain('"Storm Takeover 2024/The \\"Big\\" Final"');
  });

  it("splits a long page list into several reads, each under the URL limit, and pages through a read longer than 500 rows", async () => {
    const storm = womenRows.find((r) => r.OverviewPage === "Storm Takeover 2024")!;
    const many = Array.from({ length: 120 }, (_, i) => ({ ...storm, OverviewPage: `Storm Takeover 2024/Some Long Group Name For Chunking ${String(i).padStart(3, "0")}`, Name: `Group ${i}` }));
    // 52 complete games on one page = 520 rows: the second request of the chunk starts at offset 500.
    const games = Array.from({ length: 52 }, (_, i) => game(`Storm Takeover 2024_${i}`, "Storm Takeover 2024", "2024-06-08 11:04:00")).flat();
    const client = stubClient({ tournaments: [...womenRows, ...many], listedGames: games });
    const found = await fetchPoolInputs({ client, listedGames: true });
    const calls = scoreboard(client);
    expect(new Set(calls.map((c) => c.where)).size).toBeGreaterThan(1);
    for (const c of calls) expect(c.where.length).toBeLessThan(2400 + 600);
    expect(calls.some((c) => c.offset === "500")).toBe(true);
    expect(found.listedStats).toMatchObject({ requested: true, read: true });
    expect(found.listedRows.length).toBeGreaterThan(500);
  });

  it("counts the rows the normalizer drops by reason and warns, so missing data can be told from dropped data", async () => {
    // A game whose red team has no damage column: the whole team is dropped.
    const broken = game("Storm Takeover 2024_9", "Storm Takeover 2024", "2024-06-08 11:04:00").map((r) => (r.Team === "Red" ? { ...r, DamageToChampions: "" } : r));
    const found = await fetchPoolInputs({ client: stubClient({ tournaments: womenRows, listedGames: broken }), listedGames: true });
    expect(found.listedStats).toMatchObject({ read: true, inputRows: 10, rows: 5, dropped: { "team damage incomplete": 5 } });
    expect(found.warnings.some((w: string) => w.includes("5 of 10 scoreboard rows were dropped") && w.includes("team damage incomplete: 5"))).toBe(true);
  });
});
