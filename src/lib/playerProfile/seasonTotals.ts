import type { PlayerMatchHistoryEntryData } from "@/store/gameStore";

export interface SeasonTotals {
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  vision: number;
}

/**
 * Sums the per-match records of the running season. The backend resets a player's season
 * stats (`appearances`) at the season wrap and records one history entry per appearance, so
 * the entries of the current season must match `appearances`. When they do not (a save that
 * holds fewer records than appearances) the totals are unknown and `null` is returned
 * instead of a partial sum that would read as data.
 */
export function seasonTotalsFromHistory(
  history: PlayerMatchHistoryEntryData[],
  season: number | undefined,
  appearances: number | undefined,
): SeasonTotals | null {
  if (season === undefined || appearances === undefined) return null;
  const entries = history.filter((entry) => entry.season === season);
  if (entries.length === 0 || entries.length !== appearances) return null;

  return entries.reduce<SeasonTotals>(
    (totals, entry) => ({
      wins: totals.wins + (entry.result === "Win" ? 1 : 0),
      losses: totals.losses + (entry.result === "Win" ? 0 : 1),
      kills: totals.kills + entry.kills,
      deaths: totals.deaths + entry.deaths,
      assists: totals.assists + entry.assists,
      cs: totals.cs + entry.cs,
      vision: totals.vision + entry.visionScore,
    }),
    { wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, cs: 0, vision: 0 },
  );
}
