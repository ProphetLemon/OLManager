/**
 * What the end-of-season summary screen announces once the rollover is done.
 *
 * `advance_to_next_season` also runs when only a split ends inside a season: the
 * league keeps its season number and moves on to the next split. Only a rollover
 * that wraps the season starts a new year, so the screen compares the league it
 * now holds with the season the summary closed.
 */
export type SummaryPeriod = { kind: "season"; season: number } | { kind: "split" };

export function resolveSummaryPeriod(
  closedSeason: number,
  currentLeagueSeason: number | undefined,
): SummaryPeriod {
  // Without the league there is nothing to compare; keep announcing the next season.
  if (currentLeagueSeason === undefined) return { kind: "season", season: closedSeason + 1 };
  return currentLeagueSeason > closedSeason
    ? { kind: "season", season: currentLeagueSeason }
    : { kind: "split" };
}
