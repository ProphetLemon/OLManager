// @vitest-environment node
// Active-pros pool ratings: from stats when a player has enough games, otherwise the default of his tier and role.
import { describe, expect, it } from "vitest";
import { ATTRIBUTE_NAMES, calculateLolOvr } from "../../../scripts/stats/lib/game-world.mjs";
import { DEFAULT_OPTIONS, estimateSkill, type GameRow, type Role } from "../../../scripts/stats/lib/skill.mjs";
import {
  POOL_LEAGUE_SD, POOL_MAX_CHANGE, RATING_STATS, RATING_TIER_DEFAULT, STATS_MIN_GAMES, TIER_OFFSETS, poolSkillByPage, ratePoolPlayer, tierBaselines,
} from "../../../scripts/world/lib/pool-rating.mjs";
import { buildPoolOps, selectPool } from "../../../scripts/world/lib/pool.mjs";
import { fetchPoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import { MIN_TIER_ROLE_PLAYERS, computeBaselines } from "../../../scripts/world/lib/generate.mjs";
import { baselines, context, stubClient, world } from "./poolFixtures";

const estimate = (over: Record<string, unknown> = {}) => ({
  playerKey: "Someone", competition: "lec", role: "Mid" as Role, games: 40, effectiveGames: 30, r1: 0.1, reason: null, cohort: { scope: "competition:lec", size: 40 },
  z: 1.5, rho: 0.75, zShrunk: 1.125, ...over,
});
const tierDefault = (tier: number, position: string) => tierBaselines(baselines, tier).player(null, position);
const ovrOf = (attributes: Record<string, number>) => calculateLolOvr(attributes);

describe("ratePoolPlayer", () => {
  it("rates from stats when the player has enough games: above his tier default for a positive z, below for a negative one", () => {
    const base = ovrOf(tierDefault(2, "Mid").attributes);
    const up = ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: estimate({ z: 1.5, rho: 0.75 }) });
    const down = ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: estimate({ z: -1.5, rho: 0.75 }) });
    expect(up).toMatchObject({ source: RATING_STATS, games: 40 });
    expect(up.ovr).toBeGreaterThan(base);
    expect(down.ovr).toBeLessThan(base);
    expect(ovrOf(up.attributes)).toBe(up.ovr);
    expect(up.potential).toBeGreaterThanOrEqual(up.ovr);
  });

  it("follows the documented formula: tier default OVR + league sd x shrunk z, blended by rho", () => {
    const base = ovrOf(tierDefault(1, "Top").attributes);
    const z = 1;
    const rho = 0.5;
    const w = rho / (rho + (1 - rho)); // tau 1 for a non-suspect row
    const expected = Math.round(base + w * POOL_LEAGUE_SD * rho * z);
    const out = ratePoolPlayer({ tier: 1, position: "Top", baselines, estimate: estimate({ role: "Top", z, rho }) });
    expect(out.ovr).toBe(expected);
  });

  it("caps the change at the documented 6 points", () => {
    const base = ovrOf(tierDefault(1, "Mid").attributes);
    const out = ratePoolPlayer({ tier: 1, position: "Mid", baselines, estimate: estimate({ z: 40, rho: 0.99 }) });
    expect(out.ovr).toBe(base + POOL_MAX_CHANGE);
    const low = ratePoolPlayer({ tier: 1, position: "Mid", baselines, estimate: estimate({ z: -40, rho: 0.99 }) });
    expect(low.ovr).toBe(base - POOL_MAX_CHANGE);
  });

  it("uses the tier default when there are no stats", () => {
    for (const tier of [1, 2, 3]) {
      const out = ratePoolPlayer({ tier, position: "Support", baselines, estimate: null });
      expect(out).toMatchObject({ source: RATING_TIER_DEFAULT, reason: "no-stats", games: null });
      expect(out.attributes).toEqual(tierDefault(tier, "Support").attributes);
      expect(out.potential).toBe(tierDefault(tier, "Support").potential);
    }
  });

  it("orders the defaults by tier and keeps them role-specific", () => {
    const ovr = (tier: number, position: string) => ovrOf(ratePoolPlayer({ tier, position, baselines, estimate: null }).attributes);
    for (const position of ["Top", "Jungle", "Mid", "ADC", "Support"]) {
      expect(ovr(1, position)).toBeGreaterThan(ovr(2, position));
      expect(ovr(2, position)).toBeGreaterThan(ovr(3, position));
    }
    expect(TIER_OFFSETS).toEqual({ 1: 0, 2: -6, 3: -12 });
    expect(new Set(["Top", "Jungle", "Mid", "ADC", "Support"].map((p) => JSON.stringify(ratePoolPlayer({ tier: 1, position: p, baselines, estimate: null }).attributes))).size).toBeGreaterThan(1);
  });

  it("sits on the threshold: STATS_MIN_GAMES games rate from stats, one fewer does not", () => {
    expect(STATS_MIN_GAMES).toBe(DEFAULT_OPTIONS.minWriteGames);
    expect(ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: estimate({ games: STATS_MIN_GAMES }) }).source).toBe(RATING_STATS);
    expect(ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: estimate({ games: STATS_MIN_GAMES - 1 }) })).toMatchObject({ source: RATING_TIER_DEFAULT, reason: "below-min-games" });
  });

  it("falls back to the default for an estimate the skill model could not make or that is for another role", () => {
    expect(ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: estimate({ z: null, rho: null, zShrunk: null, reason: "cohort_too_small" }) })).toMatchObject({ source: RATING_TIER_DEFAULT, reason: "no-estimate" });
    expect(ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: estimate({ z: Number.NaN }) })).toMatchObject({ source: RATING_TIER_DEFAULT, reason: "no-estimate" });
    expect(ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: estimate({ role: "Top" }) })).toMatchObject({ source: RATING_TIER_DEFAULT, reason: "role-mismatch" });
  });

  it("treats an unknown tier as the lowest one, with and without stats", () => {
    const lowest = ratePoolPlayer({ tier: 3, position: "Mid", baselines, estimate: null });
    for (const tier of [0, 4, Number.NaN, undefined as unknown as number]) {
      expect(ratePoolPlayer({ tier, position: "Mid", baselines, estimate: null }).attributes).toEqual(lowest.attributes);
    }
    const withStats = ratePoolPlayer({ tier: 3, position: "Mid", baselines, estimate: estimate() });
    expect(ratePoolPlayer({ tier: 9, position: "Mid", baselines, estimate: estimate() }).attributes).toEqual(withStats.attributes);
  });

  it("is deterministic and keeps every attribute inside the game's 1..100 integers", () => {
    const a = ratePoolPlayer({ tier: 2, position: "ADC", baselines, estimate: estimate({ role: "Bot", z: 3, rho: 0.9 }) });
    const b = ratePoolPlayer({ tier: 2, position: "ADC", baselines, estimate: estimate({ role: "Bot", z: 3, rho: 0.9 }) });
    expect(a).toEqual(b);
    for (const name of ATTRIBUTE_NAMES) {
      expect(Number.isInteger(a.attributes[name])).toBe(true);
      expect(a.attributes[name]).toBeGreaterThanOrEqual(1);
      expect(a.attributes[name]).toBeLessThanOrEqual(100);
    }
  });
});

// A small league: 20 mids with 12 games each, the first one clearly better than the rest.
function rows(): GameRow[] {
  const out: GameRow[] = [];
  for (let p = 0; p < 20; p += 1) {
    for (let g = 0; g < 12; g += 1) {
      const skill = p === 0 ? 3 : p === 19 ? -3 : 0;
      out.push({
        playerKey: `P${p}`, competition: "lec", role: "Mid", date: `2026-0${1 + (g % 9)}-1${g % 9}`, gameMinutes: 30 + (g % 4),
        kills: 4 + skill + (p % 3), deaths: 2 + (p % 3) - (skill > 0 ? 1 : 0), assists: 6 + p % 4, teamKills: 18, damageToChampions: 18000 + 1500 * skill + p * 100,
        teamDamageToChampions: 70000, gold: 12000 + 500 * skill + p * 20, teamGold: 60000, cs: 300 + 15 * skill + p, visionScore: null,
      });
    }
  }
  return out;
}

describe("poolSkillByPage", () => {
  it("keeps one estimate per page: the usable one for the role with most games", () => {
    const list = [
      estimate({ playerKey: "A", role: "Mid", games: 10, z: 0.5, rho: 0.5 }),
      estimate({ playerKey: "A", role: "Mid", competition: "lck", games: 30, z: 1, rho: 0.6 }),
      estimate({ playerKey: "A", role: "Top", games: 99, z: 2, rho: 0.9 }),
      estimate({ playerKey: "B", role: "Mid", games: 99, z: null, rho: null, zShrunk: null, reason: "cohort_too_small" }),
    ];
    const byPage = poolSkillByPage(list as never, new Map([["A", "Mid"], ["B", "Mid"]]));
    expect(byPage.get("A")).toMatchObject({ competition: "lck", games: 30 });
    expect(byPage.has("B")).toBe(false);
  });

  it("turns recorded game rows into a rating end to end", () => {
    const estimates = estimateSkill(rows(), { referenceDate: "2026-10-01" });
    const byPage = poolSkillByPage(estimates, new Map(Array.from({ length: 20 }, (_, p) => [`P${p}`, "Mid"] as [string, string])));
    const star = ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: byPage.get("P0")! });
    const weak = ratePoolPlayer({ tier: 2, position: "Mid", baselines, estimate: byPage.get("P19")! });
    expect(star.source).toBe(RATING_STATS);
    expect(star.ovr).toBeGreaterThan(weak.ovr);
  });
});

describe("buildPoolOps ratings", () => {
  it("rates a player with stats from them and everybody else from the tier default, and says which on the op", async () => {
    const inputs = await fetchPoolInputs({ client: stubClient() });
    const selection = selectPool({ people: inputs.people, context, world });
    const tournamentIndex = new Map(inputs.tournaments.map((t) => [t.page, t]));
    const plain = buildPoolOps({ selection, tournamentIndex, games: inputs.games, baselines });
    expect(plain.players.every((e) => e.op.pool.rating === RATING_TIER_DEFAULT)).toBe(true);

    const target = selection.players[0];
    const skill = new Map([[target.page, estimate({ playerKey: target.page, role: target.person.position, z: 2, rho: 0.8 })]]);
    const rated = buildPoolOps({ selection, tournamentIndex, games: inputs.games, baselines, skill: skill as never });
    const byPage = (ops: typeof plain, page: string) => ops.players.find((e) => e.op.pool.page === page)!.op;
    expect(byPage(rated, target.page).pool.rating).toBe(RATING_STATS);
    expect(byPage(rated, target.page).player.attributes).not.toEqual(byPage(plain, target.page).player.attributes);
    for (const other of selection.players.slice(1)) expect(byPage(rated, other.page)).toEqual(byPage(plain, other.page));
    expect(rated.staff).toEqual(plain.staff);
    const expected = ratePoolPlayer({ tier: target.person.tier, position: target.role, baselines, estimate: skill.get(target.page)! as never });
    expect(byPage(rated, target.page).player.attributes).toEqual(expected.attributes);
    expect(byPage(rated, target.page).player.potential_base).toBe(expected.potential);
  });
});

describe("tier anchor (one policy with the game's placeholder ratings)", () => {
  const ATTRIBUTES = ["mechanics", "laning", "teamfighting", "macro_play", "consistency", "shotcalling", "champion_pool", "discipline", "mental_resilience"];
  const rated = (value: number) => Object.fromEntries(ATTRIBUTES.map((key) => [key, value]));
  const player = (competition: string, position: string, value: number) => ({ competition, position, raw: { attributes: rated(value), potential_base: value + 5 } });
  /** `count` real players of `position` in each competition: tier 1 rated 90, tier 2 rated 70. */
  const worldOf = (count: number, position = "Top") => ({
    competitions: [{ id: "top", tier: 1 }, { id: "second", tier: 2 }, { id: "low", tier: 4 }],
    players: [
      // One weak player keeps the shifted defaults inside the observed range.
      player("low", position, 40),
      ...Array.from({ length: count }, () => player("top", position, 90)),
      ...Array.from({ length: count }, () => player("second", position, 70)),
    ],
    staff: [],
  });

  it("takes the median of the tier's own real players in the role when the tier has enough", () => {
    const measured = computeBaselines(worldOf(MIN_TIER_ROLE_PLAYERS));
    expect(tierBaselines(measured, 2).player(null, "Top").attributes.mechanics).toBe(70);
    expect(tierBaselines(measured, 1).player(null, "Top").attributes.mechanics).toBe(90);
  });

  it("falls back to the game median shifted by the tier offset below the minimum", () => {
    const thin = computeBaselines(worldOf(MIN_TIER_ROLE_PLAYERS - 1));
    expect(thin.tierPlayer(2, "Top")).toBeNull();
    const game = thin.player(null, "Top").attributes.mechanics;
    expect(tierBaselines(thin, 2).player(null, "Top").attributes.mechanics).toBe(game + TIER_OFFSETS[2]);
  });

  it("applies the offset to a tier the world has no real players of, and counts roles apart", () => {
    const measured = computeBaselines(worldOf(MIN_TIER_ROLE_PLAYERS));
    const game = measured.player(null, "Top").attributes.mechanics;
    expect(tierBaselines(measured, 3).player(null, "Top").attributes.mechanics).toBe(game + TIER_OFFSETS[3]);
    expect(measured.tierPlayer(2, "Mid")).toBeNull();
  });
});
