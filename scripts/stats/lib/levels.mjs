// The FIXED league ladder: per OLManager competition, the median and sd of the authored OVR of its rostered players.
// Flat-50 and all-zero rows are placeholders without rating data, so they are left out. Stats only place a player
// inside his league; they never move the ladder.

/** Competitions whose level falls in the same 5-OVR-point bucket share a fallback cohort pool in the skill model. */
export const POOL_BUCKET = 5;

const round2 = (v) => Math.round(v * 100) / 100;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function populationSd(values) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** @returns {Record<string, {median: number, sd: number}>} keys sorted, values rounded to 2 decimals */
export function leagueLevels(players) {
  const byCompetition = new Map();
  for (const p of players) {
    if (!p.competition || !p.team_id || p.isFlat50 || p.isAllZero) continue;
    if (!byCompetition.has(p.competition)) byCompetition.set(p.competition, []);
    byCompetition.get(p.competition).push(p.authoredOvr);
  }
  return Object.fromEntries(
    [...byCompetition.keys()].sort(compare).map((id) => {
      const ovrs = byCompetition.get(id);
      return [id, { median: round2(median(ovrs)), sd: round2(populationSd(ovrs)) }];
    }),
  );
}

/** `options.poolOf` for estimateSkill: the 5-point bucket of a competition's level, null when it has none. */
export function poolOfLevels(levels, bucket = POOL_BUCKET) {
  return (competition) => (levels[competition] ? `level-${Math.round(levels[competition].median / bucket) * bucket}` : null);
}
