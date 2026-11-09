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
  /** Compact league tag for the panel header (LEC, LES); the full name stays in `competitionName`. */
  competitionShortName: string;
  season: number | string | null;
}

const DEFAULT_LIMIT = 8;
const SHORT_NAME_MAX = 4;

/** Names that already fit are kept; longer ones collapse to their initials (or a prefix for one word). */
export function shortCompetitionName(name: string): string {
  const trimmed = name.trim();
  if (Array.from(trimmed).length <= SHORT_NAME_MAX) return trimmed;
  const words = trimmed.split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const initials = words.length > 1 ? words.map((word) => Array.from(word)[0]).join("").toUpperCase() : "";
  const source = initials.length >= 2 ? initials : trimmed.toUpperCase();
  return Array.from(source).slice(0, SHORT_NAME_MAX).join("");
}

function activeLeague(gameState: GameStateData): LeagueData | null {
  const leagues = gameState.leagues ?? [];
  if (gameState.user_competition_id) {
    return leagues.find((league) => league.competition_id === gameState.user_competition_id) ?? leagues[0] ?? null;
  }
  return leagues[0] ?? null;
}

/**
 * Teams promoted into `league` by its latest ladder movement. A movement is recorded
 * with the season that just closed, so it only applies to the league's next season;
 * older movements, skipped ones and teams relegated again do not tag.
 */
function latestPromotedIds(gameState: GameStateData, league: LeagueData): Set<string> {
  if (league.competition_id == null) return new Set();
  const into = (gameState.ladder?.movements ?? []).filter(
    (movement) => movement.link_upper === league.competition_id,
  );
  if (into.length === 0) return new Set();
  const latestSeason = Math.max(...into.map((movement) => movement.season));
  if (typeof league.season === "number" && latestSeason < league.season - 1) return new Set();
  const latest = into.filter((movement) => movement.season === latestSeason && movement.status === "Applied");
  const relegated = new Set(latest.flatMap((movement) => movement.relegated ?? []));
  return new Set(latest.flatMap((movement) => movement.promoted ?? []).filter((id) => !relegated.has(id)));
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
  const promotedIds = latestPromotedIds(gameState, league);

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
    competitionShortName: shortCompetitionName(league.name),
    season: league.season ?? null,
  };
}
