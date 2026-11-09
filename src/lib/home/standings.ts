/** Pure data layer for the Home standings panel. */
import type { GameStateData, LeagueData } from "@/store/types";
import { compareStandingsByLolScore } from "@/store/types";
import { hasCompetitiveStandings } from "@/lib/season/seasonContext";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";

export interface StandingRow {
  position: number;
  teamId: string;
  shortName: string;
  name: string;
  logoUrl: string | null;
  won: number;
  lost: number;
  points: number;
  isMe: boolean;
  movement: "promoted" | null;
}

export interface StandingsPanelData {
  rows: StandingRow[];
  /** Index in `rows` before which a gap divider renders (the user row was appended). */
  gapBefore: number | null;
  preseason: boolean;
  competitionName: string;
  season: number | string | null;
}

const DEFAULT_LIMIT = 8;

function activeLeague(gameState: GameStateData): LeagueData | null {
  const leagues = gameState.leagues ?? [];
  if (gameState.user_competition_id) {
    return leagues.find((league) => league.competition_id === gameState.user_competition_id) ?? leagues[0] ?? null;
  }
  return leagues[0] ?? null;
}

export function getStandingsPanelData(
  gameState: GameStateData,
  opts: { limit?: number } = {},
): StandingsPanelData | null {
  const league = activeLeague(gameState);
  if (!league) return null;

  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const myTeamId = gameState.manager?.team_id ?? null;
  const teams = new Map((gameState.teams ?? []).map((team) => [team.id, team]));
  const promotedIds = new Set(
    (gameState.ladder?.movements ?? [])
      .filter((movement) => league.competition_id != null && movement.link_upper === league.competition_id)
      .flatMap((movement) => movement.promoted ?? []),
  );

  const sorted = [...(league.standings ?? [])].sort(compareStandingsByLolScore);
  const all: StandingRow[] = sorted.map((entry, index) => {
    const team = teams.get(entry.team_id);
    const name = team?.name ?? entry.team_id;
    const shortName = team?.short_name || name;
    return {
      position: index + 1,
      teamId: entry.team_id,
      shortName,
      name,
      logoUrl: team
        ? (resolveTeamLogo(team.short_name ?? team.name, team.logo_url) ?? resolveTeamLogo(team.name, team.logo_url))
        : null,
      won: entry.won,
      lost: entry.lost,
      points: entry.points,
      isMe: entry.team_id === myTeamId,
      movement: promotedIds.has(entry.team_id) ? "promoted" : null,
    };
  });

  const rows = all.slice(0, limit);
  let gapBefore: number | null = null;
  const mine = all.find((row) => row.isMe);
  if (mine && mine.position > limit) {
    // A directly adjacent row needs no divider.
    gapBefore = mine.position === limit + 1 ? null : rows.length;
    rows.push(mine);
  }

  return {
    rows,
    gapBefore,
    preseason: !hasCompetitiveStandings(gameState),
    competitionName: league.name,
    season: league.season ?? null,
  };
}
