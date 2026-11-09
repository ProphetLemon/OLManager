// The FIXED league ladder: per OLManager competition, the median and sd of the authored OVR of its rostered players.
// Flat-50, all-zero and jittered flat-band rows are placeholders without rating data, so they are left out. Stats only place a player
// inside his league; they never move the ladder.

import { isSuspect } from "./skill.mjs";

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

/** A placeholder row carries no rating data: flat 50, all zero, or jittered inside the isSuspect flat band. */
const isPlaceholder = (p) => p.isFlat50 || p.isAllZero || isSuspect({ attributes: p.attributes });

/**
 * The ladder plus, per competition, how many rostered rows fed it and how many placeholders were left out.
 * @returns {{levels: Record<string, {median: number, sd: number}>, counts: Record<string, {n_used: number, n_excluded: number}>}}
 */
export function leagueLevelStats(players) {
  const used = new Map();
  const excluded = new Map();
  for (const p of players) {
    if (!p.competition || !p.team_id) continue;
    if (!used.has(p.competition)) {
      used.set(p.competition, []);
      excluded.set(p.competition, 0);
    }
    if (isPlaceholder(p)) excluded.set(p.competition, excluded.get(p.competition) + 1);
    else used.get(p.competition).push(p.authoredOvr);
  }
  const ids = [...used.keys()].filter((id) => used.get(id).length > 0).sort(compare);
  return {
    levels: Object.fromEntries(ids.map((id) => [id, { median: round2(median(used.get(id))), sd: round2(populationSd(used.get(id))) }])),
    counts: Object.fromEntries(ids.map((id) => [id, { n_used: used.get(id).length, n_excluded: excluded.get(id) }])),
  };
}

/** @returns {Record<string, {median: number, sd: number}>} keys sorted, values rounded to 2 decimals */
export function leagueLevels(players) {
  return leagueLevelStats(players).levels;
}

/** `options.poolOf` for estimateSkill: the 5-point bucket of a competition's level, null when it has none. */
export function poolOfLevels(levels, bucket = POOL_BUCKET) {
  return (competition) => (levels[competition] ? `level-${Math.round(levels[competition].median / bucket) * bucket}` : null);
}
