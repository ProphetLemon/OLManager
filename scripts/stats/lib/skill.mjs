// Pure, deterministic skill model for stat-derived player ratings.
// No I/O, no clock, no randomness: the same rows (in any order) give the same output.
//
// Pipeline: per-game features -> recency-weighted player means -> cohort z-scores
// (per competition and role) -> weighted composite re-standardized in the cohort ->
// split-half reliability r1 -> Spearman-Brown shrinkage -> OVR target on a FIXED
// league ladder -> blend with the authored OVR.

export const ROLES = Object.freeze(["Top", "Jungle", "Mid", "Bot", "Support"]);

export const DEFAULT_OPTIONS = Object.freeze({
  halfLifeDays: 270,
  minCohortGames: 10,
  minCohortSize: 15,
  minWriteGames: 8,
  defaultR1: 0.1,
  minR1: 0.02,
  maxR1: 0.5,
  minR1Pairs: 20,
  // Composite weights. Win rate is deliberately NOT a feature. damagePerMinute is
  // redundant with damageShare and so is off by default.
  featureWeights: Object.freeze({
    kda: 1,
    killParticipation: 1,
    damageShare: 1,
    damagePerMinute: 0,
    csPerMinute: 1,
    goldShare: 1,
    negDeathsPerGame: 1,
    visionPerMinute: 0.5,
  }),
});

export const DEFAULT_SUSPECT_THRESHOLDS = Object.freeze({ flatLow: 44, flatHigh: 56, belowMedian: 12 });
export const DEFAULT_BLEND_OPTIONS = Object.freeze({ tau: 1, suspectTau: 0.35, maxTrust: 0.9 });
export const DEFAULT_SD_CLAMP = Object.freeze({ min: 3, max: 5 });

const MS_PER_DAY = 86400000;
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Parses "YYYY-MM-DD" to a UTC day number, or NaN when invalid. */
export function dayNumber(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

/**
 * Per-game features. A feature is omitted (never NaN/Infinity) when its inputs are
 * missing or its denominator is zero or invalid. Higher is better for every feature.
 */
export function gameFeatures(row) {
  const f = {};
  const { kills: k, deaths: d, assists: a, teamKills, gameMinutes: min } = row;
  const minutesOk = isNum(min) && min > 0;
  if (isNum(k) && isNum(a) && isNum(d)) {
    f.kda = (k + a) / Math.max(1, d);
    f.negDeathsPerGame = -d;
  }
  if (isNum(k) && isNum(a) && isNum(teamKills) && teamKills >= 0) {
    f.killParticipation = (k + a) / Math.max(1, teamKills);
  }
  if (isNum(row.damageToChampions) && isNum(row.teamDamageToChampions) && row.teamDamageToChampions > 0) {
    f.damageShare = row.damageToChampions / row.teamDamageToChampions;
  }
  if (isNum(row.damageToChampions) && minutesOk) f.damagePerMinute = row.damageToChampions / min;
  if (isNum(row.cs) && minutesOk) f.csPerMinute = row.cs / min;
  if (isNum(row.gold) && isNum(row.teamGold) && row.teamGold > 0) f.goldShare = row.gold / row.teamGold;
  if ((row.role === "Support" || row.role === "Jungle") && isNum(row.visionScore) && minutesOk) {
    f.visionPerMinute = row.visionScore / min;
  }
  return f;
}

/** Recency weight 0.5^(ageDays/halfLifeDays); future games count as age 0. */
export function recencyWeight(ageDays, halfLifeDays = DEFAULT_OPTIONS.halfLifeDays) {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

/** Reliability of an n-game mean given single-game reliability r1. */
export function spearmanBrown(r1, n) {
  return (n * r1) / (1 + (n - 1) * r1);
}

/** Single-game reliability from the reliability rn of a mean over n games. */
export function inverseSpearmanBrown(rn, n) {
  return rn / (n - (n - 1) * rn);
}

/** Shrinkage factor rho(n) for n effective games. */
export function rho(n, r1) {
  return n > 0 ? spearmanBrown(r1, n) : 0;
}

// Stable row order: date, then a key made of the row's own numbers.
function rowKey(r) {
  return [r.date, r.gameMinutes, r.kills, r.deaths, r.assists, r.teamKills, r.damageToChampions, r.gold, r.cs].join("|");
}
function sortRows(rows) {
  return rows.slice().sort((x, y) => cmp(x.date, y.date) || cmp(rowKey(x), rowKey(y)));
}

function weightedFeatureMeans(rows, ref, halfLife) {
  const sums = {};
  const wsum = {};
  let effective = 0;
  for (const r of rows) {
    const day = dayNumber(r.date);
    const w = Number.isNaN(day) ? 0 : recencyWeight(ref - day, halfLife);
    effective += w;
    const f = gameFeatures(r);
    for (const name of Object.keys(f)) {
      sums[name] = (sums[name] ?? 0) + w * f[name];
      wsum[name] = (wsum[name] ?? 0) + w;
    }
  }
  const features = {};
  for (const name of Object.keys(sums).sort()) if (wsum[name] > 0) features[name] = sums[name] / wsum[name];
  return { features, effectiveGames: effective };
}

function groupRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.playerKey}\u0000${r.competition}\u0000${r.role}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { playerKey: r.playerKey, competition: r.competition, role: r.role, rows: [] }));
    g.rows.push(r);
  }
  const out = [...groups.entries()].sort((a, b) => cmp(a[0], b[0])).map(([, g]) => ({ ...g, rows: sortRows(g.rows) }));
  return out;
}

/**
 * Per (playerKey, competition, role): recency-weighted feature means, raw game
 * count and effective (weighted) game count. Sorted by key.
 * options: { referenceDate (required, "YYYY-MM-DD"), halfLifeDays }.
 */
export function aggregatePlayers(rows, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const ref = dayNumber(o.referenceDate);
  if (Number.isNaN(ref)) throw new Error("referenceDate must be a YYYY-MM-DD string");
  return groupRows(rows).map((g) => {
    const { features, effectiveGames } = weightedFeatureMeans(g.rows, ref, o.halfLifeDays);
    return { playerKey: g.playerKey, competition: g.competition, role: g.role, features, games: g.rows.length, effectiveGames, rows: g.rows };
  });
}

function meanSd(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, sd: 0, n };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n);
  return { mean, sd, n };
}

// Weighted mean of the player's available feature z-scores.
function rawComposite(features, featureStats, weights) {
  let num = 0;
  let den = 0;
  for (const name of Object.keys(featureStats).sort()) {
    const w = weights[name] ?? 0;
    const x = features[name];
    if (!(w > 0) || !isNum(x)) continue;
    const st = featureStats[name];
    num += w * (st.sd > 0 ? (x - st.mean) / st.sd : 0);
    den += w;
  }
  return den > 0 ? num / den : null;
}

function buildCohortStats(members, weights) {
  const names = new Set();
  for (const m of members) for (const n of Object.keys(m.features)) names.add(n);
  const featureStats = {};
  for (const name of [...names].sort()) {
    const vals = members.map((m) => m.features[name]).filter(isNum);
    if (vals.length >= 2) featureStats[name] = meanSd(vals);
  }
  const composites = members.map((m) => rawComposite(m.features, featureStats, weights)).filter((c) => c !== null);
  const comp = meanSd(composites);
  return { featureStats, compositeMean: comp.mean, compositeSd: comp.sd, size: members.length };
}

const standardized = (stats, weights, features) => {
  const c = rawComposite(features, stats.featureStats, weights);
  if (c === null) return null;
  return stats.compositeSd > 0 ? (c - stats.compositeMean) / stats.compositeSd : 0;
};

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/**
 * Single-game reliability r1 by split-half. `entries` are { rows, stats } where
 * stats are the player's cohort stats. Each player's games (ordered by date then a
 * stable key) are split into alternating halves, each half is turned into a
 * standardized composite, halves are correlated across players, and the half-length
 * reliability is converted to r1 with the inverse Spearman-Brown formula.
 * With fewer than minR1Pairs players, or an undefined correlation, returns
 * options.defaultR1. The result is clamped to [minR1, maxR1].
 */
export function estimateR1(entries, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const ref = dayNumber(o.referenceDate);
  const xs = [], ys = [], lens = [];
  for (const e of entries) {
    const rows = sortRows(e.rows);
    const a = rows.filter((_, i) => i % 2 === 0);
    const b = rows.filter((_, i) => i % 2 === 1);
    if (!a.length || !b.length) continue;
    const ha = weightedFeatureMeans(a, ref, o.halfLifeDays);
    const hb = weightedFeatureMeans(b, ref, o.halfLifeDays);
    const za = standardized(e.stats, o.featureWeights, ha.features);
    const zb = standardized(e.stats, o.featureWeights, hb.features);
    if (za === null || zb === null) continue;
    xs.push(za); ys.push(zb); lens.push((ha.effectiveGames + hb.effectiveGames) / 2);
  }
  const clamp = (v) => Math.min(o.maxR1, Math.max(o.minR1, v));
  if (xs.length < o.minR1Pairs) return { r1: clamp(o.defaultR1), source: "default", pairs: xs.length, halfCorrelation: null };
  const rh = pearson(xs, ys);
  if (Number.isNaN(rh)) return { r1: clamp(o.defaultR1), source: "default", pairs: xs.length, halfCorrelation: null };
  const k = lens.reduce((s, v) => s + v, 0) / lens.length;
  const raw = k > 1 ? inverseSpearmanBrown(Math.max(rh, 0), k) : rh;
  return { r1: clamp(raw), source: "split-half", pairs: xs.length, halfCorrelation: rh };
}

/**
 * Stat-derived skill estimates for every (player, competition, role).
 *
 * Cohorts: members of a cohort are players with >= minCohortGames raw games in the
 * same (competition, role). If that has fewer than minCohortSize members, the
 * fallback pool is used: members of the same role in every competition with the
 * same options.poolOf(competition) id (the pool includes the competition itself).
 * If there is no poolOf, or the pool is also smaller than minCohortSize, the cohort
 * is unusable and those players get estimate null with reason "cohort_too_small".
 * Players with fewer than minWriteGames raw games get null ("below_min_write_games").
 * Players with minWriteGames..minCohortGames-1 games are scored against the cohort
 * but never shape it.
 *
 * Each result: { playerKey, competition, role, games, effectiveGames, reason,
 *   cohort: {scope, size} | null, z, rho, zShrunk, r1 } (z/rho/zShrunk null when no estimate).
 */
export function estimateSkill(rows, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const players = aggregatePlayers(rows, o);
  const eligible = players.filter((p) => p.games >= o.minCohortGames);
  const poolOf = typeof o.poolOf === "function" ? o.poolOf : null;

  const scopeCache = new Map();
  const statsFor = (scope, members) => {
    const key = `${scope}\u0000${members.role}`;
    if (!scopeCache.has(key)) scopeCache.set(key, buildCohortStats(members.list, o.featureWeights));
    return scopeCache.get(key);
  };
  const resolve = (p) => {
    const own = eligible.filter((m) => m.competition === p.competition && m.role === p.role);
    if (own.length >= o.minCohortSize) return { scope: `competition:${p.competition}`, stats: statsFor(`competition:${p.competition}`, { role: p.role, list: own }) };
    if (!poolOf) return null;
    const pool = poolOf(p.competition);
    if (pool === undefined || pool === null) return null;
    const list = eligible.filter((m) => m.role === p.role && poolOf(m.competition) === pool);
    if (list.length < o.minCohortSize) return null;
    return { scope: `pool:${pool}`, stats: statsFor(`pool:${pool}`, { role: p.role, list }) };
  };

  const resolved = players.map((p) => ({ p, c: p.games >= o.minWriteGames ? resolve(p) : null }));
  const entries = resolved
    .filter(({ p, c }) => c && p.games >= o.minCohortGames)
    .map(({ p, c }) => ({ rows: p.rows, stats: c.stats }));
  const r1 = estimateR1(entries, o);

  return resolved.map(({ p, c }) => {
    const base = { playerKey: p.playerKey, competition: p.competition, role: p.role, games: p.games, effectiveGames: p.effectiveGames, r1: r1.r1 };
    const none = (reason) => ({ ...base, reason, cohort: c ? { scope: c.scope, size: c.stats.size } : null, z: null, rho: null, zShrunk: null });
    if (p.games < o.minWriteGames) return none("below_min_write_games");
    if (!c) return none("cohort_too_small");
    const z = standardized(c.stats, o.featureWeights, p.features);
    if (z === null) return none("no_features");
    const r = rho(p.effectiveGames, r1.r1);
    return { ...base, reason: null, cohort: { scope: c.scope, size: c.stats.size }, z, rho: r, zShrunk: r * z };
  });
}

/**
 * Whether an authored row looks unreliable. `attributes` is an array or object of
 * the 9 attribute values. Suspect when all 9 lie in [flatLow, flatHigh] but are not
 * all exactly 50 (jittered placeholders), or when authoredOvr <= leagueMedian -
 * belowMedian. Rows that are exactly flat 50 are placeholder_ratings.rs territory
 * and are never suspect here.
 */
export function isSuspect({ attributes, authoredOvr, leagueMedian }, thresholds = {}) {
  const t = { ...DEFAULT_SUSPECT_THRESHOLDS, ...thresholds };
  const values = Array.isArray(attributes) ? attributes : Object.values(attributes ?? {});
  if (values.length !== 9 || !values.every(isNum)) return false;
  if (values.every((v) => v === 50)) return false;
  if (values.every((v) => v >= t.flatLow && v <= t.flatHigh)) return true;
  return isNum(authoredOvr) && isNum(leagueMedian) && authoredOvr <= leagueMedian - t.belowMedian;
}

/**
 * OVR implied by the stats on the fixed ladder: median + clamp(sd, 3, 5) * zShrunk.
 * Returns null when any input is not a finite number.
 */
export function ovrTarget(leagueMedian, leagueSd, zShrunk, sdClamp = DEFAULT_SD_CLAMP) {
  if (!isNum(leagueMedian) || !isNum(leagueSd) || !isNum(zShrunk)) return null;
  return leagueMedian + Math.min(sdClamp.max, Math.max(sdClamp.min, leagueSd)) * zShrunk;
}

/**
 * Blend authored and stat OVR. w0 = rho; w = w0 / (w0 + (1 - w0) * tau) with tau 1
 * normally and suspectTau (0.35) for suspect rows, capped at maxTrust (0.9).
 * Returns every intermediate so a report can show them. Returns null when z, rho,
 * authoredOvr, leagueMedian or leagueSd is not a finite number (for example the
 * null z/rho of a no-estimate row), so such a row is never blended.
 */
export function blendRating({ authoredOvr, leagueMedian, leagueSd, z, rho: rhoValue, suspect = false }, options = {}) {
  if (![authoredOvr, leagueMedian, leagueSd, z, rhoValue].every(isNum)) return null;
  const o = { ...DEFAULT_BLEND_OPTIONS, ...options };
  const zShrunk = rhoValue * z;
  const target = ovrTarget(leagueMedian, leagueSd, zShrunk, o.sdClamp);
  const tau = suspect ? o.suspectTau : o.tau;
  const w0 = rhoValue;
  const denom = w0 + (1 - w0) * tau;
  const w = Math.min(o.maxTrust, denom > 0 ? w0 / denom : 0);
  const finalOvr = (1 - w) * authoredOvr + w * target;
  return { z, rho: rhoValue, zShrunk, target, tau, w, authoredOvr, finalOvr };
}
