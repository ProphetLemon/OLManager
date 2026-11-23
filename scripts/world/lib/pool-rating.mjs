// Ratings of the active-pros pool. A pool player is rated from his per-game stats when he has enough of them, otherwise
// he gets a default. Pure and deterministic: no I/O, no clock, no randomness.
//
// Two ways to anchor (A6f). Without `anchors` (no game ladder given) the anchor is the tier-role baseline and everybody
// else takes the tier default: the method the first pool shipped with. With `anchors` (`pool-anchors.mjs`: the game's
// league levels and the defaults of its rostered players) the pool is rated the way build-overrides.mjs rates rostered
// players: a stats-rated player sits on the level of the league his stats come from (`anchors.levels`), a player without
// a usable estimate takes the default of the league he last played in, and a player with no mapped league takes a
// labelled judgment default. There is no discount for being teamless or inactive: no data supports one.
//
// Stats path (the method of docs/STAT_RATINGS.md, reusing scripts/stats/lib):
//   1. the skill model (`estimateSkill`) gives a role-relative z-score per player, shrunk by reliability (`rho`);
//   2. the anchor is both his "authored" OVR and the league median: the median of his league's level (with anchors) or
//      the tier default OVR of his role (without);
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
 * Tier default, one policy with the game's placeholder ratings (`placeholder_ratings.rs`): the median of the real players
 * of the person's tier in the position when the tier has enough of them (`baselines.tierPlayer`); otherwise the game's
 * median for the position shifted by the tier of the person's best competition (1 top flight, 2 official circuit,
 * 3 recurring seasonal league). An unknown tier counts as the lowest one.
 */
export const TIER_OFFSETS = Object.freeze({ 1: 0, 2: -6, 3: -12 });

/** `pool.rating` values: what the attributes of an op were derived from. */
export const RATING_STATS = "stats";
export const RATING_TIER_DEFAULT = "tier-default";
/** With anchors: the median of the rostered players of the league he last played in who also have no estimate. */
export const RATING_LEAGUE_DEFAULT = "league-default";
/** With anchors: his league has too few such players, so the median of the game tier of that league is used. */
export const RATING_GAME_TIER_DEFAULT = "game-tier-default";
/** With anchors: no league the game models, so the default of the game's tier-2 population. A judgment, not a measurement. */
export const RATING_JUDGMENT_DEFAULT = "judgment-default";
/**
 * JUDGMENT, pool tiers 1 and 2 only (a tier-3 person with no mapped league keeps the tier-3 baseline: nothing measured tier 3, and the
 * judgment figure would rank him above the rostered tier-2 bench). The leagues of players with no mapped league (LCP Wildcard, Battle of S.E.A, Thailand Series, ...) are minor leagues
 * the game does not model. They take the default of the game's tier-2 population of rostered players with no estimate (329 of
 * them), which is the nearest measured population, not the 12-player tier-1 figure. Nothing validates this number for them.
 */
export const JUDGMENT_DEFAULT_TIER = 2;

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

/** Baselines of one tier: the tier's own median when measured, else shifted by the tier offset (see TIER_OFFSETS). */
export function tierBaselines(baselines, tier) {
  const delta = TIER_OFFSETS[tier] ?? TIER_OFFSETS[3];
  return {
    player(competition, position) {
      const measured = baselines.tierPlayer?.(tier, position);
      if (measured) return measured;
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
 * The league a pool player last played in, among the leagues the game models: the competition of the pool-scope tournament that
 * started last, among tournaments whose Leaguepedia page starts with a prefix of `anchors.prefixes` (scripts/stats/prefix-map.json)
 * and whose league has a level. Ties on the start date go to the page in code-unit order, so the list's order never matters.
 *
 * @param {object} input
 * @param {string[]} input.tournaments Leaguepedia tournament pages of the person
 * @param {Map<string, {start?: string}>} input.tournamentIndex tournaments by page
 * @param {{levels: Record<string, unknown>, prefixes: Record<string, string[]>}} input.anchors
 * @returns {string|null} competition id, or null when none of his tournaments is in a modelled league
 */
export function latestMappedCompetition({ tournaments, tournamentIndex, anchors }) {
  const prefixes = Object.entries(anchors.prefixes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let best = null;
  for (const page of tournaments ?? []) {
    const competition = prefixes.find(([, list]) => list.some((prefix) => page.startsWith(prefix)))?.[0];
    if (!competition || !anchors.levels[competition]) continue;
    const start = tournamentIndex?.get(page)?.start ?? "";
    if (!best || start > best.start || (start === best.start && page < best.page)) best = { competition, start, page };
  }
  return best?.competition ?? null;
}

/**
 * The baselines a pool player's record is generated from. Without anchors: the tier of the person. With anchors: the median of the
 * league he last played in (his league's players, by role), or the game's tier-2 median when he has no mapped league. This only
 * gives the record its role shape and its potential; the OVR comes from `ratePoolPlayer`.
 */
export function shapeBaselines({ baselines, tier, anchors, competition }) {
  if (!anchors) return tierBaselines(baselines, tier);
  if (competition && anchors.levels[competition]) {
    return { player: (_, position) => baselines.player(competition, position), staff: (role) => baselines.staff(role) };
  }
  return tierBaselines(baselines, hasJudgmentDefault(tier) ? JUDGMENT_DEFAULT_TIER : tier);
}

/** The judgment default covers pool tiers 1 and 2 only: nothing measured tier 3 (any other tier counts as 3, as in `tierBaselines`). */
const hasJudgmentDefault = (tier) => tier === 1 || tier === 2;

/** The default OVR and where it comes from, for a player with anchors and no usable estimate. */
function defaultOf(anchors, competition) {
  if (competition && anchors.levels[competition]) {
    const own = anchors.leagueDefault?.[competition];
    if (own) return { source: RATING_LEAGUE_DEFAULT, median: own.median };
    const tierPopulation = anchors.tierDefault?.[anchors.tierOf?.[competition]];
    if (tierPopulation) return { source: RATING_GAME_TIER_DEFAULT, median: tierPopulation.median };
  }
  return { source: RATING_JUDGMENT_DEFAULT, median: anchors.tierDefault[JUDGMENT_DEFAULT_TIER].median };
}

/**
 * Rate one pool player.
 *
 * @param {object} input
 * @param {number} input.tier tier of the player's best competition (1, 2 or 3; anything else counts as 3)
 * @param {string} input.position game position (Top, Jungle, Mid, ADC, Support)
 * @param {import("./pool.mjs").Baselines} input.baselines the game's baselines (median per position)
 * @param {import("../../stats/lib/skill.mjs").SkillEstimate|null} [input.estimate] the skill estimate of the player, if any
 * @param {object|null} [input.anchors] the game's league levels and defaults (pool-anchors.mjs); without them the tier baseline anchors
 * @param {string|null} [input.competition] the league he last played in (`latestMappedCompetition`); with anchors only
 * @param {{attributes: Record<string, number>, potential: number}|null} [input.seed] with anchors: the seeded record the default is
 *   derived from, so players of one league are not clones; stats ratings start from the unjittered league baseline
 * @returns {{source: string, reason: string|null, attributes: Record<string, number>, potential: number, ovr: number, games: number|null, competition: string|null}}
 *   `reason` says why a player fell back to a default; without anchors the default carries the exact tier baseline (no jitter)
 */
export function ratePoolPlayer({ tier, position, baselines, estimate = null, anchors = null, competition = null, seed = null }) {
  if (anchors) return rateAnchored({ tier, position, baselines, estimate, anchors, competition, seed });
  const base = tierBaselines(baselines, tier).player(null, position);
  const authoredOvr = calculateLolOvr(base.attributes);
  const fallback = (reason) => ({ source: RATING_TIER_DEFAULT, reason, attributes: { ...base.attributes }, potential: base.potential, ovr: authoredOvr, games: null, competition: null });

  if (!estimate) return fallback("no-stats");
  if (gamePosition(estimate.role) !== gamePosition(position)) return fallback("role-mismatch");
  if (!(estimate.games >= STATS_MIN_GAMES)) return fallback("below-min-games");
  const blend = blendRating({ authoredOvr, leagueMedian: authoredOvr, leagueSd: POOL_LEAGUE_SD, z: estimate.z, rho: estimate.rho });
  if (!blend) return fallback("no-estimate");

  const finalOvr = clamp(blend.finalOvr, authoredOvr - POOL_MAX_CHANGE, authoredOvr + POOL_MAX_CHANGE);
  const derived = deriveAttributes({ attributes: base.attributes, authoredOvr, finalOvr, games: estimate.games, potentialBase: base.potential });
  return {
    source: RATING_STATS, reason: null, attributes: derived.attributes, potential: clamp(derived.potentialFloor, 1, 100), ovr: derived.newOvr, games: estimate.games, competition: null,
  };
}

/** `ratePoolPlayer` with the game's league ladder: the anchor of a stats rating is his league's level, not a tier baseline. */
function rateAnchored({ tier, position, baselines, estimate, anchors, competition, seed }) {
  const reason = !estimate ? "no-stats"
    : gamePosition(estimate.role) !== gamePosition(position) ? "role-mismatch"
      : !(estimate.games >= STATS_MIN_GAMES) ? "below-min-games"
        : !anchors.levels[estimate.competition] ? "no-league-level"
          : null;
  if (reason === null) {
    const level = anchors.levels[estimate.competition];
    const blend = blendRating({ authoredOvr: level.median, leagueMedian: level.median, leagueSd: level.sd, z: estimate.z, rho: estimate.rho });
    if (blend) {
      const shape = baselines.player(estimate.competition, position);
      const finalOvr = clamp(blend.finalOvr, level.median - POOL_MAX_CHANGE, level.median + POOL_MAX_CHANGE);
      const derived = deriveAttributes({ attributes: shape.attributes, authoredOvr: calculateLolOvr(shape.attributes), finalOvr, games: estimate.games, potentialBase: shape.potential });
      return {
        source: RATING_STATS, reason: null, attributes: derived.attributes, potential: clamp(derived.potentialFloor, 1, 100), ovr: derived.newOvr, games: estimate.games, competition: estimate.competition,
      };
    }
  }
  const { source, median } = defaultOf(anchors, competition);
  if (source === RATING_JUDGMENT_DEFAULT && !hasJudgmentDefault(tier)) {
    // A tier-3 person with no mapped league keeps the tier-3 baseline (the record's own seeded shape), as before the ladder existed.
    const base = tierBaselines(baselines, tier).player(null, position);
    return { source: RATING_TIER_DEFAULT, reason: "no-mapped-league", attributes: { ...base.attributes }, potential: base.potential, ovr: calculateLolOvr(base.attributes), games: null, competition: null };
  }
  const shaped = shapeBaselines({ baselines, tier, anchors, competition }).player(null, position);
  const shape = seed ?? { attributes: shaped.attributes, potential: shaped.potential };
  const derived = deriveAttributes({ attributes: shape.attributes, authoredOvr: calculateLolOvr(shape.attributes), finalOvr: median, games: 0, potentialBase: shape.potential });
  return {
    source,
    reason: source === RATING_JUDGMENT_DEFAULT ? "no-mapped-league" : (reason ?? "no-estimate"),
    attributes: derived.attributes,
    potential: clamp(derived.potentialFloor, 1, 100),
    ovr: derived.newOvr,
    games: null,
    competition: source === RATING_JUDGMENT_DEFAULT ? null : competition,
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
 * form a cohort gives no estimate and its players take a default. Pass `poolOfLevels(levels)` (scripts/stats/lib/levels.mjs)
 * to rate them as build-overrides.mjs rates rostered players: small leagues borrow the cohort of leagues of a similar level.
 *
 * @param {import("../../stats/lib/skill.mjs").GameRow[]} rows
 * @param {Map<string, string>} positions role of each pool player by page
 * @param {{poolOf?: (competition: string) => string|null|undefined}} [options]
 */
export function poolSkillFromRows(rows, positions, { poolOf } = {}) {
  const referenceDate = rows.reduce((max, r) => (r.date > max ? r.date : max), "1970-01-01");
  if (Number.isNaN(dayNumber(referenceDate))) throw new Error("pool stats: rows carry no valid date");
  return poolSkillByPage(estimateSkill(rows, { referenceDate, ...(poolOf ? { poolOf } : {}) }), positions);
}

/** The fewest games in the activity window that settle a player's position (step a of the position evidence). */
export const POSITION_MIN_GAMES = 5;

/**
 * Where each pool player has played lately, from the per-game rows of `scripts/stats/pro-stats.mjs`: the role most of his games
 * in the activity window (`since`, the pool's own) were played in, with how many games and the date of the newest. A player with
 * fewer than `POSITION_MIN_GAMES` games, or whose games split with no role over half, has no entry.
 * @param {Array<{playerKey: string, role: string, date: string}>} rows
 * @param {{since: string}} options first date of the window, YYYY-MM-DD
 * @returns {Map<string, {position: string, games: number, last: string}>}
 */
export function recentRolesFromRows(rows, { since }) {
  const byPlayer = new Map();
  for (const row of rows) {
    if (!(row.date >= since)) continue;
    const entry = byPlayer.get(row.playerKey) ?? { games: 0, last: "", roles: new Map() };
    entry.games += 1;
    if (row.date > entry.last) entry.last = row.date;
    entry.roles.set(row.role, (entry.roles.get(row.role) ?? 0) + 1);
    byPlayer.set(row.playerKey, entry);
  }
  const roles = new Map();
  for (const [page, entry] of byPlayer) {
    if (entry.games < POSITION_MIN_GAMES) continue;
    const [role, count] = [...entry.roles].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
    if (count * 2 > entry.games) roles.set(page, { position: role, games: entry.games, last: entry.last });
  }
  return roles;
}
