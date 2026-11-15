import type { GameStateData, LeagueData } from "../store/types";

type LeagueHolder = Pick<GameStateData, "leagues" | "user_competition_id">;

/**
 * The league the user plays in: the one whose `competition_id` equals
 * `user_competition_id`. The league list is loaded in manifest order, so the user's
 * league is not necessarily first. Falls back to the first league when the state has no
 * `user_competition_id` (old saves) or no league matches it.
 *
 * This is the only place allowed to read the head of `gameState.leagues` (see
 * `src/lib/userLeague.guard.test.ts`).
 */
export function resolveUserLeague(
  gameState: Partial<LeagueHolder> | null | undefined,
): LeagueData | null {
  const leagues = gameState?.leagues ?? [];
  const userCompetitionId = gameState?.user_competition_id;
  if (userCompetitionId) {
    const match = leagues.find((league) => league.competition_id === userCompetitionId);
    if (match) return match;
  }
  return leagues[0] ?? null;
}

/**
 * The league a club actually plays in: the one matching its `competition_id`, else the
 * one whose standings list it (the user's league first). Falls back to the user's league.
 */
export function resolveTeamLeague(
  gameState: Partial<LeagueHolder> | null | undefined,
  team: { id: string; competition_id?: string | null },
): LeagueData | null {
  const leagues = gameState?.leagues ?? [];
  if (team.competition_id) {
    const byCompetition = leagues.find((league) => league.competition_id === team.competition_id);
    if (byCompetition) return byCompetition;
  }
  const userLeague = resolveUserLeague(gameState);
  const lists = (league: LeagueData) => league.standings.some((entry) => entry.team_id === team.id);
  if (userLeague && lists(userLeague)) return userLeague;
  return leagues.find(lists) ?? userLeague;
}
