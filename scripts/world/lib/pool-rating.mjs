// Ratings of the active-pros pool. A pool player is rated from his per-game stats when he has enough of them, otherwise
// he gets the default of his tier and role. Pure and deterministic: no I/O, no clock, no randomness.
//
// Stats path (the method of docs/STAT_RATINGS.md, reusing scripts/stats/lib):
//   1. the skill model (`estimateSkill`) gives a role-relative z-score per player, shrunk by reliability (`rho`);
//   2. the tier default of the player's role is the anchor: both his "authored" OVR and the league median;
//   3. `blendRating` turns z, rho and the anchor into a final OVR (league sd POOL_LEAGUE_SD, trust blend of the doc);
//   4. the change is capped at POOL_MAX_CHANGE points, the doc's cap for rows that are not suspect;
//   5. `deriveAttributes` spreads the change over the nine attributes (measured ones take all of it, shotcalling,
//      discipline and mental resilience follow with `skill_carry`) so that round(mean of nine) is the final OVR.
// Staff have no per-game stats: they always take the tier default.
import { calculateLolOvr } from "../../stats/lib/game-world.mjs";
import { deriveAttributes } from "../../stats/lib/attributes.mjs";
import { DEFAULT_OPTIONS, blendRating, dayNumber, estimateSkill } from "../../stats/lib/skill.mjs";

/** The position names the game's overlay uses; Leaguepedia says "Bot" where the game says "ADC". */
export const GAME_POSITION = Object.freeze({ Top: "Top", Jungle: "Jungle", Mid: "Mid", Bot: "ADC", Support: "Support" });

/**
 * Tier default: the game's median for the position, shifted by the tier of the person's best competition
 * (1 top flight, 2 official circuit, 3 recurring seasonal league). An unknown tier counts as the lowest one.
 */
export const TIER_OFFSETS = Object.freeze({ 1: 0, 2: -6, 3: -12 });

/** `pool.rating` values: what the attributes of an op were derived from. */
export const RATING_STATS = "stats";
export const RATING_TIER_DEFAULT = "tier-default";

/** Games a player needs before his stats count: the skill model's own write floor (docs/STAT_RATINGS.md: "8-game floor"). */
export const STATS_MIN_GAMES = DEFAULT_OPTIONS.minWriteGames;
/** Spread of one league in OVR points: the middle of the 3..5 range the skill model clamps to. */
export const POOL_LEAGUE_SD = 4;
/** Largest OVR change from the tier default, as for non-suspect rows in docs/STAT_RATINGS.md. */
export const POOL_MAX_CHANGE = 6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const gamePosition = (role) => GAME_POSITION[role] ?? role;

function shift(values, delta, range) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, clamp(value + delta, range?.[key]?.min ?? 1, range?.[key]?.max ?? 100)]));
}

/** Baselines shifted by the tier offset: the tier default rating (see TIER_OFFSETS). */
export function tierBaselines(baselines, tier) {
  const delta = TIER_OFFSETS[tier] ?? TIER_OFFSETS[3];
  return {
    player(competition, position) {
      const base = baselines.player(competition, position);
      return { ...base, attributes: shift(base.attributes, delta, base.range), potential: clamp(base.potential + delta, 1, 100) };
    },
    staff(role) {
      const base = baselines.staff(role);
      return { ...base, attributes: shift(base.attributes, delta, base.range) };
    },
  };
}

/**
 * Rate one pool player.
 *
 * @param {object} input
 * @param {number} input.tier tier of the player's best competition (1, 2 or 3; anything else counts as 3)
 * @param {string} input.position game position (Top, Jungle, Mid, ADC, Support)
 * @param {import("./pool.mjs").Baselines} input.baselines the game's baselines (median per position)
 * @param {import("../../stats/lib/skill.mjs").SkillEstimate|null} [input.estimate] the skill estimate of the player, if any
 * @returns {{source: "stats"|"tier-default", reason: string|null, attributes: Record<string, number>, potential: number, ovr: number, games: number|null}}
 *   `reason` says why a player fell back to the tier default; the default carries the exact tier baseline (no jitter)
 */
export function ratePoolPlayer({ tier, position, baselines, estimate = null }) {
  const base = tierBaselines(baselines, tier).player(null, position);
  const authoredOvr = calculateLolOvr(base.attributes);
  const fallback = (reason) => ({ source: RATING_TIER_DEFAULT, reason, attributes: { ...base.attributes }, potential: base.potential, ovr: authoredOvr, games: null });

  if (!estimate) return fallback("no-stats");
  if (gamePosition(estimate.role) !== gamePosition(position)) return fallback("role-mismatch");
  if (!(estimate.games >= STATS_MIN_GAMES)) return fallback("below-min-games");
  const blend = blendRating({ authoredOvr, leagueMedian: authoredOvr, leagueSd: POOL_LEAGUE_SD, z: estimate.z, rho: estimate.rho });
  if (!blend) return fallback("no-estimate");

  const finalOvr = clamp(blend.finalOvr, authoredOvr - POOL_MAX_CHANGE, authoredOvr + POOL_MAX_CHANGE);
  const derived = deriveAttributes({ attributes: base.attributes, authoredOvr, finalOvr, games: estimate.games, potentialBase: base.potential });
  return {
    source: RATING_STATS, reason: null, attributes: derived.attributes, potential: clamp(derived.potentialFloor, 1, 100), ovr: derived.newOvr, games: estimate.games,
  };
}

/**
 * One usable skill estimate per Leaguepedia page: the one for the player's own role with the most games (ties go to the
 * competition id in code-unit order). Pages with no usable estimate are left out, so they take the tier default.
 *
 * @param {import("../../stats/lib/skill.mjs").SkillEstimate[]} estimates result of `estimateSkill`
 * @param {Map<string, string>} positions role of each pool player by page (Leaguepedia or game position name)
 * @returns {Map<string, import("../../stats/lib/skill.mjs").SkillEstimate>}
 */
export function poolSkillByPage(estimates, positions) {
  const best = new Map();
  for (const e of estimates) {
    const position = positions.get(e.playerKey);
    if (position === undefined || gamePosition(e.role) !== gamePosition(position) || !isNum(e.z) || !isNum(e.rho)) continue;
    const current = best.get(e.playerKey);
    if (!current || e.games > current.games || (e.games === current.games && e.competition < current.competition)) best.set(e.playerKey, e);
  }
  return best;
}

/**
 * Skill estimates of the pool players from the per-game rows of `scripts/stats/pro-stats.mjs` (`rows.json`).
 * The reference date is the newest row. Without a competition-group `poolOf`, a competition with too few players to
 * form a cohort gives no estimate and its players take the tier default.
 *
 * @param {import("../../stats/lib/skill.mjs").GameRow[]} rows
 * @param {Map<string, string>} positions role of each pool player by page
 */
export function poolSkillFromRows(rows, positions) {
  const referenceDate = rows.reduce((max, r) => (r.date > max ? r.date : max), "1970-01-01");
  if (Number.isNaN(dayNumber(referenceDate))) throw new Error("pool stats: rows carry no valid date");
  return poolSkillByPage(estimateSkill(rows, { referenceDate }), positions);
}
