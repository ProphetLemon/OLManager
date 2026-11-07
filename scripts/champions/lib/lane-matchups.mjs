// Pure aggregation of pro-play lane matchups. No I/O: callers pass scoreboard rows.
//
// A row is one player-game: { gameId, champion, role, win }. Two rows of the same game and role with
// opposite results are one lane matchup (champion A against champion B in that role).

export const DEFAULT_MIN_GAMES = 20;
/** A pair qualifies only when the 95% Wilson lower bound of its win rate reaches this value. */
export const DEFAULT_MIN_LOWER_BOUND = 0.5;

/**
 * Bands on the Wilson lower bound for the curation counter value (1 = slight edge, 5 = near-unplayable matchup).
 * Using the lower bound keeps small samples from reaching high values on a lucky raw win rate.
 */
export const STRENGTH_BANDS = [
  { min: 0.7, value: 5 },
  { min: 0.6, value: 4 },
  { min: 0.55, value: 3 },
  { min: 0.52, value: 2 },
  { min: 0.5, value: 1 },
];

/** 95% Wilson score lower bound of a win rate. */
export function wilsonLowerBound(wins, games, z = 1.96) {
  if (games <= 0) return 0;
  const p = wins / games;
  const z2 = z * z;
  const centre = p + z2 / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games));
  return (centre - margin) / (1 + z2 / games);
}

/**
 * Resolves a Leaguepedia champion name to the game's champion id (lowercase), through champion-list entries
 * { id, name }. Returns null when the name matches no entry.
 */
export function createChampionResolver(champions) {
  const byName = new Map();
  for (const { id, name } of champions) {
    const gameId = canonicalChampionId(id);
    byName.set(gameId, gameId);
    byName.set(canonicalChampionId(name), gameId);
  }
  return (value) => byName.get(canonicalChampionId(value)) ?? null;
}

export function canonicalChampionId(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "wukong" || normalized === "monkeyking" ? "monkeyking" : normalized;
}

/** Leaguepedia roles to the game's roles; null for anything else. */
export function canonicalRole(value) {
  const map = { top: "Top", jungle: "Jungle", mid: "Mid", bot: "Bot", support: "Support" };
  return map[String(value).trim().toLowerCase()] ?? null;
}

/**
 * Counts each directed pair once per game. Games whose role slot is not exactly one winner and one loser
 * (remakes, missing data, duplicate rows) are skipped and counted in `skipped`.
 * Returns { matchups: [{role, source, target, games, wins}], skipped, laneGames }.
 * `wins` are wins of `source`; both directions are emitted for every matchup.
 */
export function aggregateLaneMatchups(rows) {
  const slots = new Map();
  for (const row of rows) {
    const role = canonicalRole(row.role);
    const champion = row.champion ? canonicalChampionId(row.champion) : "";
    if (!role || !champion || !row.gameId || typeof row.win !== "boolean") continue;
    const key = `${row.gameId}::${role}`;
    const slot = slots.get(key) ?? { role, entries: [] };
    slot.entries.push({ champion, win: row.win });
    slots.set(key, slot);
  }
  const pairs = new Map();
  let skipped = 0;
  let laneGames = 0;
  for (const { role, entries } of slots.values()) {
    const winners = entries.filter((entry) => entry.win);
    const losers = entries.filter((entry) => !entry.win);
    if (entries.length !== 2 || winners.length !== 1 || losers.length !== 1) {
      skipped += 1;
      continue;
    }
    const [winner] = winners;
    const [loser] = losers;
    if (winner.champion === loser.champion) continue;
    laneGames += 1;
    bump(pairs, role, winner.champion, loser.champion, true);
    bump(pairs, role, loser.champion, winner.champion, false);
  }
  const matchups = [...pairs.values()].sort(
    (a, b) => a.role.localeCompare(b.role) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
  return { matchups, skipped, laneGames };
}

function bump(pairs, role, source, target, won) {
  const key = `${role}::${source}::${target}`;
  const entry = pairs.get(key) ?? { role, source, target, games: 0, wins: 0 };
  entry.games += 1;
  if (won) entry.wins += 1;
  pairs.set(key, entry);
}

/** Counter value 1..5 for a Wilson lower bound, or null below the counter threshold. */
export function strengthForLowerBound(lowerBound, bands = STRENGTH_BANDS) {
  return bands.find((band) => lowerBound >= band.min)?.value ?? null;
}

/**
 * Directed counter candidates: pairs with enough games and a Wilson lower bound at or above the threshold.
 * When a pair qualifies in several roles, the role with the most games wins (ties: higher win rate).
 */
export function deriveCounterCandidates(matchups, { minGames = DEFAULT_MIN_GAMES, minLowerBound = DEFAULT_MIN_LOWER_BOUND } = {}) {
  const best = new Map();
  for (const matchup of matchups) {
    if (matchup.games < minGames) continue;
    const winRate = matchup.wins / matchup.games;
    const lowerBound = wilsonLowerBound(matchup.wins, matchup.games);
    if (lowerBound < minLowerBound) continue;
    const value = strengthForLowerBound(lowerBound);
    if (value === null) continue;
    const candidate = { ...matchup, winRate, lowerBound, value };
    const key = `${matchup.source}::${matchup.target}`;
    const current = best.get(key);
    if (!current || candidate.games > current.games || (candidate.games === current.games && candidate.winRate > current.winRate)) {
      best.set(key, candidate);
    }
  }
  return [...best.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
}

/**
 * Compares curated counters with the data. A curated pair is "contradicted" when the reverse direction
 * meets the counter threshold with the minimum sample (the data says the opposite champion is ahead).
 */
export function findContradictions(curatedCounters, matchups, options = {}) {
  const candidates = deriveCounterCandidates(matchups, options);
  const reverse = new Map(candidates.map((candidate) => [`${candidate.source}::${candidate.target}`, candidate]));
  return curatedCounters
    .map(({ source, target, value }) => ({ source, target, value, against: reverse.get(`${target}::${source}`) }))
    .filter((entry) => entry.against);
}

/** Role distribution per champion from raw rows: { champion: { Top: n, ... } } over canonical roles. */
export function roleDistribution(rows) {
  const out = {};
  for (const row of rows) {
    const role = canonicalRole(row.role);
    if (!role || !row.champion) continue;
    const champion = canonicalChampionId(row.champion);
    out[champion] ??= {};
    out[champion][role] = (out[champion][role] ?? 0) + 1;
  }
  return out;
}
