/** Grouping of leagues into main (tier 1) and regional (tier >= 2) sets. */

interface Tiered {
  tier?: number;
}

export interface LeagueGroups<T extends Tiered> {
  main: T[];
  regional: T[];
}

/** Tier 0 (unknown) is treated as a main league, matching the backend default. */
export function isRegionalTier(tier: number | undefined): boolean {
  return (tier ?? 1) >= 2;
}

/** Splits leagues into main and regional groups, keeping the incoming order inside each. */
export function groupLeaguesByTier<T extends Tiered>(leagues: readonly T[]): LeagueGroups<T> {
  const main: T[] = [];
  const regional: T[] = [];
  for (const league of leagues) {
    (isRegionalTier(league.tier) ? regional : main).push(league);
  }
  return { main, regional };
}

interface PlayableLeague extends Tiered {
  active?: boolean;
  fixtures?: readonly unknown[];
}

/**
 * Leagues listed in the Competitions tab: every active tier-1 league, then active
 * regional leagues that actually have fixtures to show.
 */
export function listCompetitionLeagues<T extends PlayableLeague>(leagues: readonly T[]): T[] {
  const active = leagues.filter((league) => league.active === true);
  const { main, regional } = groupLeaguesByTier(active);
  return [...main.filter((league) => league.tier === 1), ...regional.filter((league) => (league.fixtures?.length ?? 0) > 0)];
}
