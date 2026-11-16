// @vitest-environment node
// Pool ratings anchored to the game's league levels (A6f, method c): stats-rated players sit on the level of their league, players
// without a usable estimate take the default of the league they last played in, and the players with no mapped league take a
// labelled judgment default. No teamless discount.
import { describe, expect, it } from "vitest";
import { calculateLolOvr } from "../../../scripts/stats/lib/game-world.mjs";
import { estimateSkill, type GameRow, type Role } from "../../../scripts/stats/lib/skill.mjs";
import { fetchPoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import { MIN_LEAGUE_DEFAULT_PLAYERS, buildPoolAnchors } from "../../../scripts/world/lib/pool-anchors.mjs";
import {
  JUDGMENT_DEFAULT_TIER, POOL_MAX_CHANGE, RATING_GAME_TIER_DEFAULT, RATING_JUDGMENT_DEFAULT, RATING_LEAGUE_DEFAULT, RATING_STATS, RATING_TIER_DEFAULT,
  latestMappedCompetition, poolSkillFromRows, ratePoolPlayer, shapeBaselines,
} from "../../../scripts/world/lib/pool-rating.mjs";
import { buildPoolOps, selectPool } from "../../../scripts/world/lib/pool.mjs";
import { baselines, context, stubClient, world } from "./poolFixtures";

/** A small ladder: a game tier-1 league (lck), a game tier-2 league with a measured default (ljl) and a thin one (tiny, tier 1). */
const anchors = {
  levels: { lck: { median: 82, sd: 4 }, ljl: { median: 66, sd: 4 }, tiny: { median: 70, sd: 4 } },
  prefixes: { lck: ["LCK/"], ljl: ["LJL/"], tiny: ["Tiny/"], nolevel: ["Nolevel/"] },
  leagueDefault: { ljl: { median: 63, n: 20 } },
  tierDefault: { 1: { median: 78, n: 12 }, 2: { median: 61, n: 329 } },
  tierOf: { lck: 1, ljl: 2, tiny: 1 },
};
const estimate = (over: Record<string, unknown> = {}) => ({
  playerKey: "Someone", competition: "ljl", role: "Mid" as Role, games: 40, effectiveGames: 30, r1: 0.1, reason: null, cohort: { scope: "competition:ljl", size: 40 },
  z: 0, rho: 0.5, zShrunk: 0, ...over,
});
const rate = (over: Record<string, unknown> = {}) =>
  ratePoolPlayer({ tier: 1, position: "Mid", baselines, estimate: null, anchors, competition: null, ...over } as never);

describe("stats-rated pool players are anchored to the level of their league", () => {
  it("puts a player with z = 0 on the median of the league his stats come from, not on the tier baseline", () => {
    const out = rate({ estimate: estimate({ z: 0 }) });
    expect(out).toMatchObject({ source: RATING_STATS, games: 40 });
    expect(out.ovr).toBe(66);
    expect(calculateLolOvr(out.attributes)).toBe(66);
    // The tier-1 baseline of the old method is far above that league.
    const old = ratePoolPlayer({ tier: 1, position: "Mid", baselines, estimate: estimate({ z: 0 }) as never });
    expect(old.ovr).toBeGreaterThan(75);
  });

  it("moves him by his stats around that league median, capped at the documented 6 points", () => {
    expect(rate({ estimate: estimate({ z: 1.5, rho: 0.75 }) }).ovr).toBeGreaterThan(66);
    expect(rate({ estimate: estimate({ z: -1.5, rho: 0.75 }) }).ovr).toBeLessThan(66);
    expect(rate({ estimate: estimate({ z: 40, rho: 0.99 }) }).ovr).toBe(66 + POOL_MAX_CHANGE);
    expect(rate({ estimate: estimate({ z: -40, rho: 0.99 }) }).ovr).toBe(66 - POOL_MAX_CHANGE);
  });

  it("uses the league of the estimate, whatever the tier of the player", () => {
    expect(rate({ tier: 3, estimate: estimate({ competition: "lck" }) }).ovr).toBe(82);
    expect(rate({ tier: 1, estimate: estimate({ competition: "lck" }) }).ovr).toBe(82);
  });

  it("never gives a stats-rated player a potential below his OVR", () => {
    const out = rate({ estimate: estimate({ competition: "lck", z: 3, rho: 0.9 }) });
    expect(out.potential).toBeGreaterThanOrEqual(out.ovr);
  });
});

describe("players without a usable estimate", () => {
  it("take the default of the league they last played in (the median of that league's rostered players with no estimate)", () => {
    const out = rate({ competition: "ljl" });
    expect(out).toMatchObject({ source: RATING_LEAGUE_DEFAULT, reason: "no-stats", games: null });
    expect(out.ovr).toBe(63);
    expect(calculateLolOvr(out.attributes)).toBe(63);
    expect(out.potential).toBeGreaterThanOrEqual(63);
  });

  it("also when the estimate is unusable: another role, too few games, or no estimate", () => {
    for (const bad of [estimate({ role: "Top" }), estimate({ games: 3 }), estimate({ z: null, rho: null, zShrunk: null, reason: "cohort_too_small" })]) {
      const out = rate({ competition: "ljl", estimate: bad });
      expect(out.source).toBe(RATING_LEAGUE_DEFAULT);
      expect(out.ovr).toBe(63);
    }
  });

  it("add no discount for being teamless: a tier-1 and a tier-3 person of the same league get the same rating", () => {
    expect(rate({ tier: 1, competition: "ljl" }).ovr).toBe(rate({ tier: 3, competition: "ljl" }).ovr);
  });

  it("fall back to the game-tier population when the league has fewer than the minimum of such players, and say so", () => {
    expect(MIN_LEAGUE_DEFAULT_PLAYERS).toBe(10);
    const out = rate({ competition: "tiny" });
    expect(out).toMatchObject({ source: RATING_GAME_TIER_DEFAULT });
    expect(out.ovr).toBe(78);
    expect(rate({ competition: "lck" }).ovr).toBe(78);
  });

  it("take the tier-2 judgment default when no league is mapped, even for a tier-1 person", () => {
    expect(JUDGMENT_DEFAULT_TIER).toBe(2);
    const out = rate({ tier: 1, competition: null });
    expect(out).toMatchObject({ source: RATING_JUDGMENT_DEFAULT, reason: "no-mapped-league" });
    expect(out.ovr).toBe(61);
    expect(calculateLolOvr(out.attributes)).toBe(61);
  });

  it("keep the tier-3 baseline for a tier-3 person with no mapped league: nothing measured tier 3, so no judgment default", () => {
    for (const tier of [3, 4, Number.NaN]) {
      const out = rate({ tier, competition: null });
      expect(out).toMatchObject({ source: RATING_TIER_DEFAULT, reason: "no-mapped-league" });
      expect(out.attributes).toEqual(ratePoolPlayer({ tier: 3, position: "Mid", baselines, estimate: null }).attributes);
    }
    expect(rate({ tier: 3, competition: null }).ovr).toBe(calculateLolOvr(ratePoolPlayer({ tier: 3, position: "Mid", baselines, estimate: null }).attributes));
    // Tier 1 and tier 2 people with no mapped league still take the judgment default.
    for (const tier of [1, 2]) expect(rate({ tier, competition: null })).toMatchObject({ source: RATING_JUDGMENT_DEFAULT, ovr: 61 });
    // A tier-3 person whose league is mapped keeps that league's default.
    expect(rate({ tier: 3, competition: "ljl" }).source).toBe(RATING_LEAGUE_DEFAULT);
  });

  it("count a league the game has no level for as unmapped", () => {
    expect(rate({ competition: "nolevel" }).source).toBe(RATING_JUDGMENT_DEFAULT);
  });

  it("treat a stats estimate for a league without a level like no estimate", () => {
    const out = rate({ competition: "ljl", estimate: estimate({ competition: "nolevel" }) });
    expect(out.source).toBe(RATING_LEAGUE_DEFAULT);
    expect(out.ovr).toBe(63);
  });

  it("keep a seeded shape when one is given, so players of one league are not clones, and still land on the default OVR", () => {
    const seed = { attributes: { ...baselines.player(null, "Mid").attributes, mechanics: 40, laning: 90 }, potential: 70 };
    const out = rate({ competition: "ljl", seed });
    expect(out.ovr).toBe(63);
    expect(out.attributes).not.toEqual(rate({ competition: "ljl" }).attributes);
  });

  it("still use the tier default when the run has no anchors", () => {
    const out = ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: null });
    expect(out.source).toBe(RATING_TIER_DEFAULT);
  });
});

describe("latestMappedCompetition", () => {
  const index = new Map(
    [
      ["LCK/2024 Spring", "2024-01-10"], ["LJL/2025 Spring", "2025-01-12"], ["LJL/2024 Summer", "2024-06-01"], ["Nolevel/2026", "2026-02-01"], ["Other/2026", "2026-03-01"],
    ].map(([page, start]) => [page, { page, start }]),
  );
  const pick = (tournaments: string[]) => latestMappedCompetition({ tournaments, tournamentIndex: index as never, anchors });

  it("is the league of the entry that started last, among leagues that have a prefix and a level", () => {
    expect(pick(["LCK/2024 Spring", "LJL/2024 Summer", "LJL/2025 Spring"])).toBe("ljl");
    expect(pick(["LJL/2025 Spring", "LCK/2024 Spring"])).toBe("ljl");
  });

  it("skips tournaments of leagues the game has no level or no prefix for", () => {
    expect(pick(["LCK/2024 Spring", "Nolevel/2026", "Other/2026"])).toBe("lck");
  });

  it("is null when nothing maps, and does not depend on the order of the list when two start on the same day", () => {
    expect(pick(["Other/2026", "Unknown/2026"])).toBeNull();
    expect(pick([])).toBeNull();
    const same = new Map([["LCK/A", { page: "LCK/A", start: "2025-01-01" }], ["LJL/A", { page: "LJL/A", start: "2025-01-01" }]]);
    const a = latestMappedCompetition({ tournaments: ["LCK/A", "LJL/A"], tournamentIndex: same as never, anchors });
    const b = latestMappedCompetition({ tournaments: ["LJL/A", "LCK/A"], tournamentIndex: same as never, anchors });
    expect(a).toBe(b);
  });
});

describe("buildPoolAnchors", () => {
  const attrs = (v: number) => Object.fromEntries(["mechanics", "laning", "teamfighting", "macro_play", "consistency", "shotcalling", "champion_pool", "discipline", "mental_resilience"].map((k, i) => [k, v + (i % 3) * 12]));
  let n = 0;
  const player = (competition: string | null, ovr: number, over: Record<string, unknown> = {}) => {
    n += 1;
    return { id: `p${n}`, team_id: competition ? `${competition}-t` : null, competition, attributes: attrs(ovr - 12), authoredOvr: ovr, isFlat50: false, isAllZero: false, ...over };
  };
  const ljl = Array.from({ length: 12 }, (_, i) => player("ljl", 60 + i));
  const lck = [player("lck", 80), player("lck", 90)];
  const estimated = Array.from({ length: 3 }, (_, i) => player("ljl", 70 + i));
  const mover = player("ljl", 99);
  const flat = player("ljl", 50, { isFlat50: true, attributes: Object.fromEntries(Object.keys(attrs(0)).map((k) => [k, 50])) });
  const teamless = player(null, 10);
  const records = [
    ...estimated.map((p) => ({ id: p.id, reason: null, competitionMismatch: false })),
    { id: mover.id, reason: "kept_league_mover" },
    ...ljl.slice(0, 2).map((p) => ({ id: p.id, reason: "no_rows" })),
  ];
  const built = buildPoolAnchors({
    levels: anchors.levels, records, players: [...ljl, ...lck, ...estimated, mover, flat, teamless], tierOf: new Map([["ljl", 2], ["lck", 1]]), prefixes: anchors.prefixes,
  });

  it("takes the league default from rostered players with no usable estimate, leaving out estimated players, movers, placeholders and teamless people", () => {
    expect(built.leagueDefault.ljl).toEqual({ median: 65.5, n: 12 });
  });

  it("gives no league default to a league with fewer such players than the minimum", () => {
    expect(built.leagueDefault.lck).toBeUndefined();
  });

  it("builds the game-tier populations (median and size) of those players", () => {
    expect(built.tierDefault[2]).toEqual({ median: 65.5, n: 12 });
    expect(built.tierDefault[1]).toEqual({ median: 85, n: 2 });
    expect(built.tierOf).toEqual({ ljl: 2, lck: 1 });
    expect(built.levels).toBe(anchors.levels);
  });
});

describe("poolOf reaches the skill model", () => {
  /** Two leagues of 8 players with 12 games each: neither has a cohort of 15 alone, together they do. */
  const rows = (): GameRow[] =>
    ["lecA", "lecB"].flatMap((competition) =>
      Array.from({ length: 8 }, (_, p) =>
        Array.from({ length: 12 }, (_, g): GameRow => ({
          playerKey: `${competition}-P${p}`, competition, role: "Mid", date: `2026-0${1 + (g % 9)}-1${g % 9}`, gameMinutes: 30 + (g % 4),
          kills: 4 + (p % 3), deaths: 2 + (p % 3), assists: 6 + (p % 4), teamKills: 18, damageToChampions: 18000 + p * 100, teamDamageToChampions: 70000,
          gold: 12000 + p * 20, teamGold: 60000, cs: 300 + p, visionScore: null,
        })),
      ).flat(),
    );
  const positions = new Map(["lecA", "lecB"].flatMap((c) => Array.from({ length: 8 }, (_, p) => [`${c}-P${p}`, "Mid"] as [string, string])));

  it("gives no estimate to a small league on its own, and one when the caller pools it with another", () => {
    expect(estimateSkill(rows(), { referenceDate: "2026-10-01" }).every((e) => e.reason === "cohort_too_small")).toBe(true);
    expect(poolSkillFromRows(rows(), positions).size).toBe(0);
    const pooled = poolSkillFromRows(rows(), positions, { poolOf: () => "level-70" });
    expect(pooled.size).toBe(16);
  });
});

describe("buildPoolOps with anchors", () => {
  it("rates by stats, league default and judgment default, and says which on the op", async () => {
    const inputs = await fetchPoolInputs({ client: stubClient() });
    const selection = selectPool({ people: inputs.people, context, world });
    const tournamentIndex = new Map(inputs.tournaments.map((t) => [t.page, t]));
    const [first, second] = selection.players.filter((e) => (e.person.tournaments ?? []).length > 0);
    // The whole page of his first tournament is the prefix: only players of that tournament map to the league.
    const prefixOf = (e: (typeof selection.players)[number]) => (e.person.tournaments as string[])[0];
    const own = { ...anchors, prefixes: { ...anchors.prefixes, ljl: [prefixOf(first)] } };
    const skill = new Map([[second.page, estimate({ playerKey: second.page, role: second.person.position, competition: "lck", z: 0 })]]);
    const ops = buildPoolOps({ selection, tournamentIndex, games: inputs.games, baselines, anchors: own as never, skill: skill as never });
    const byPage = (page: string) => ops.players.find((e) => e.op.pool.page === page)!.op;

    expect(byPage(second.page).pool).toMatchObject({ rating: RATING_STATS, rating_competition: "lck" });
    expect(calculateLolOvr(byPage(second.page).player.attributes)).toBe(82);
    expect(byPage(first.page).pool).toMatchObject({ rating: RATING_LEAGUE_DEFAULT, rating_competition: "ljl" });
    expect(calculateLolOvr(byPage(first.page).player.attributes)).toBe(63);
    const unmapped = selection.players.find((e) => e !== first && e !== second && !(e.person.tournaments ?? []).some((p: string) => p.startsWith(prefixOf(first))))!;
    expect(byPage(unmapped.page).pool).toMatchObject({ rating: RATING_JUDGMENT_DEFAULT });
    expect(calculateLolOvr(byPage(unmapped.page).player.attributes)).toBe(61);
    // Staff keep the tier default: they have no stats and no league.
    expect(ops.staff.every((e) => e.op.pool.rating === RATING_TIER_DEFAULT)).toBe(true);
  });

  it("keeps every default-rated player's potential at or above his OVR and inside 1..100", async () => {
    const inputs = await fetchPoolInputs({ client: stubClient() });
    const selection = selectPool({ people: inputs.people, context, world });
    const ops = buildPoolOps({ selection, tournamentIndex: new Map(inputs.tournaments.map((t) => [t.page, t])), games: inputs.games, baselines, anchors: anchors as never });
    // The tier default (staff, and tier-3 people with no mapped league) keeps the baseline's own potential, as it always did.
    for (const { op } of ops.players.filter((e) => e.op.pool.rating !== RATING_TIER_DEFAULT)) {
      expect(op.player.potential_base).toBeGreaterThanOrEqual(calculateLolOvr(op.player.attributes));
      expect(op.player.potential_base).toBeLessThanOrEqual(100);
    }
  });

  it("derives the shape of a league-anchored rating from the league's baselines", () => {
    const shaped = shapeBaselines({ baselines, tier: 1, anchors: anchors as never, competition: "ljl" });
    expect(shaped.player(null, "Mid")).toEqual(baselines.player("ljl", "Mid"));
    expect(shapeBaselines({ baselines, tier: 1, anchors: null, competition: "ljl" }).player(null, "Mid").attributes).toEqual(shapeBaselines({ baselines, tier: 1, anchors: undefined as never, competition: null }).player(null, "Mid").attributes);
  });
});
