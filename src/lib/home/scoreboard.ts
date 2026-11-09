/**
 * Pure data layer for the Home scoreboard hero.
 *
 * Imports only from leaf modules so Home and Dashboard tests that mock
 * `@/lib/common/helpers`, `@/lib/home/helpers` or `@/lib/dashboard/helpers`
 * keep working.
 */
import type { FixtureData, GameStateData, LeagueData, PlayerData, TeamData } from "@/store/types";
import { resolveActiveLineupIds } from "@/store/types";
import { getDaysUntil } from "@/lib/common/contractUtils";
import { findNextFixture } from "@/lib/common/fixtures";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { LOL_ACTIVE_ROLES, buildActiveLineupIds } from "@/lib/squad/helpers";
import {
  FALLBACK_SECONDARY,
  SURFACE,
  contrastRatio,
  ensureContrast,
  hexToOklch,
  resolveClubPalette,
} from "@/lib/teams/clubColors";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";
import { TEAM_LOGO_PALETTE } from "@/lib/teams/teamPalette.generated";

export type LolRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

export interface LineupPlate {
  role: LolRole;
  playerId: string | null;
  name: string;
  ovr: number | null;
  photo: string | null;
}

export interface SidePalette {
  accent: string;
  accentText: string;
  foreground: string;
  secondary: string | null;
  source: string;
}

export interface SideData {
  teamId: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  palette: SidePalette;
  lineup: LineupPlate[];
  lineupOvr: number | null;
  form: ("W" | "L" | "D")[];
}

export interface ScoreboardData {
  fixtureId: string;
  date: string;
  matchday: number;
  isHome: boolean;
  kind: "League" | "Friendly" | "PreseasonTournament" | "Playoffs";
  bestOf: number | null;
  competitionName: string;
  season: number | string | null;
  daysToGo: number;
  you: SideData;
  opponent: SideData;
}

/** Placeholder shown on a plate whose role has no player. */
const EMPTY_PLATE_NAME = "—";
/** Two accents closer than this OKLab distance read as the same colour. */
export const ACCENT_COLLISION_DISTANCE = 0.1;
const FORM_LENGTH = 5;

function distanceInOklab(a: string, b: string): number {
  const first = hexToOklch(a);
  const second = hexToOklch(b);
  const toLab = ({ l, c, h }: { l: number; c: number; h: number }) => {
    const rad = (h * Math.PI) / 180;
    return [l, c * Math.cos(rad), c * Math.sin(rad)] as const;
  };
  const [l1, a1, b1] = toLab(first);
  const [l2, a2, b2] = toLab(second);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function readableForeground(accent: string): string {
  return contrastRatio("#0a0a0a", accent) >= contrastRatio("#ffffff", accent) ? "#0a0a0a" : "#ffffff";
}

function toSidePalette(team: TeamData, highContrast: boolean): SidePalette {
  const palette = resolveClubPalette(team, TEAM_LOGO_PALETTE, { highContrast });
  const defaultSecondary = resolveClubPalette(null, TEAM_LOGO_PALETTE, { highContrast }).secondary;
  return {
    accent: palette.accent,
    accentText: palette.accentText,
    foreground: palette.accentForeground,
    secondary: palette.secondary === defaultSecondary ? null : palette.secondary,
    source: palette.source,
  };
}

function withAccent(base: SidePalette, rawAccent: string, source: string, highContrast: boolean): SidePalette {
  const accent = ensureContrast(rawAccent, SURFACE, highContrast ? 4.5 : 3);
  return {
    accent,
    accentText: ensureContrast(accent, SURFACE, 4.5),
    foreground: readableForeground(accent),
    secondary: base.secondary,
    source,
  };
}

/**
 * The opponent never wears the same colour as the user. When the accents are
 * too close in OKLab, or the opponent only has the generic fallback colour,
 * it falls back to its own secondary and then to neutral zinc.
 */
export function separateOpponentPalette(
  you: SidePalette,
  opponent: SidePalette,
  highContrast: boolean,
): SidePalette {
  const clashes = (accent: string) => distanceInOklab(you.accent, accent) < ACCENT_COLLISION_DISTANCE;
  if (opponent.source !== "fallback" && !clashes(opponent.accent)) return opponent;

  if (opponent.secondary && !clashes(opponent.secondary)) {
    return withAccent(opponent, opponent.secondary, "secondary", highContrast);
  }
  return withAccent(opponent, FALLBACK_SECONDARY, "neutral", highContrast);
}

function normalizeForm(form: readonly string[] | undefined): ("W" | "L" | "D")[] {
  const result: ("W" | "L" | "D")[] = [];
  for (const entry of (form ?? []).slice(-FORM_LENGTH)) {
    const letter = String(entry).charAt(0).toUpperCase();
    if (letter === "W" || letter === "L" || letter === "D") result.push(letter);
  }
  return result;
}

function buildLineup(team: TeamData, players: readonly PlayerData[]): { lineup: LineupPlate[]; ovr: number | null } {
  const roster = players.filter((player) => player.team_id === team.id);
  const byId = new Map(roster.map((player) => [player.id, player]));
  const ids = buildActiveLineupIds(roster, resolveActiveLineupIds(team));

  const lineup = LOL_ACTIVE_ROLES.map((role, index): LineupPlate => {
    const player = byId.get(ids[index] ?? "");
    if (!player) return { role, playerId: null, name: EMPTY_PLATE_NAME, ovr: null, photo: null };
    return {
      role,
      playerId: player.id,
      name: player.match_name,
      ovr: calculateLolOvr(player),
      photo: resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url),
    };
  });

  const rated = lineup.flatMap((plate) => (plate.ovr === null ? [] : [plate.ovr]));
  const ovr = rated.length ? Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10) / 10 : null;
  return { lineup, ovr };
}

function buildSide(team: TeamData, players: readonly PlayerData[], palette: SidePalette): SideData {
  const { lineup, ovr } = buildLineup(team, players);
  return {
    teamId: team.id,
    name: team.name,
    shortName: team.short_name || team.name,
    logoUrl: resolveTeamLogo(team.short_name ?? team.name, team.logo_url) ?? resolveTeamLogo(team.name, team.logo_url),
    palette,
    lineup,
    lineupOvr: ovr,
    form: normalizeForm(team.form),
  };
}

function activeLeague(gameState: GameStateData): LeagueData | null {
  const leagues = gameState.leagues ?? [];
  if (gameState.user_competition_id) {
    return leagues.find((league) => league.competition_id === gameState.user_competition_id) ?? leagues[0] ?? null;
  }
  return leagues[0] ?? null;
}

export function getScoreboardData(gameState: GameStateData, opts: { highContrast: boolean }): ScoreboardData | null {
  const teamId = gameState.manager?.team_id;
  const league = activeLeague(gameState);
  if (!teamId || !league) return null;

  const fixture: FixtureData | undefined = findNextFixture(league.fixtures ?? [], teamId);
  if (!fixture) return null;

  const teams = gameState.teams ?? [];
  const isHome = fixture.home_team_id === teamId;
  const myTeam = teams.find((team) => team.id === teamId);
  const opponentTeam = teams.find((team) => team.id === (isHome ? fixture.away_team_id : fixture.home_team_id));
  if (!myTeam || !opponentTeam) return null;

  const players = gameState.players ?? [];
  const youPalette = toSidePalette(myTeam, opts.highContrast);
  const opponentPalette = separateOpponentPalette(youPalette, toSidePalette(opponentTeam, opts.highContrast), opts.highContrast);

  const today = (gameState.clock?.current_date ?? "").slice(0, 10);
  return {
    fixtureId: fixture.id,
    date: fixture.date,
    matchday: fixture.matchday,
    isHome,
    kind: fixture.match_type ?? "League",
    bestOf: fixture.best_of ?? null,
    competitionName: league.name,
    season: league.season ?? null,
    daysToGo: Math.max(0, getDaysUntil(fixture.date.slice(0, 10), today)),
    you: buildSide(myTeam, players, youPalette),
    opponent: buildSide(opponentTeam, players, opponentPalette),
  };
}
