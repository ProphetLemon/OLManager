// Pure aggregation of pro-play lane matchups. No I/O: callers pass scoreboard rows.
//
// A row is one player-game: { gameId, champion, role, win }. Two rows of the same game and role with
// opposite results are one lane matchup (champion A against champion B in that role).

export const DEFAULT_MIN_GAMES = 12;
export const DEFAULT_MIN_WIN_RATE = 0.55;

/**
 * Win-rate bands for the curation counter value (1 = slight edge, 5 = near-unplayable matchup).
 * Pro-play win rates are compressed by draft selection, so the bands start low: 0.55 is already a clear edge.
 */
export const STRENGTH_BANDS = [
  { min: 0.8, value: 5 },
  { min: 0.72, value: 4 },
  { min: 0.65, value: 3 },
  { min: 0.6, value: 2 },
  { min: 0.55, value: 1 },
];

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

/** Counter value 1..5 for a win rate, or null below the counter threshold. */
export function strengthForWinRate(winRate, bands = STRENGTH_BANDS) {
  return bands.find((band) => winRate >= band.min)?.value ?? null;
}

/**
 * Directed counter candidates: pairs with enough games and a win rate at or above the threshold.
 * When a pair qualifies in several roles, the role with the most games wins (ties: higher win rate).
 */
export function deriveCounterCandidates(matchups, { minGames = DEFAULT_MIN_GAMES, minWinRate = DEFAULT_MIN_WIN_RATE } = {}) {
  const best = new Map();
  for (const matchup of matchups) {
    if (matchup.games < minGames) continue;
    const winRate = matchup.wins / matchup.games;
    if (winRate < minWinRate) continue;
    const value = strengthForWinRate(winRate);
    if (value === null) continue;
    const candidate = { ...matchup, winRate, value };
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
