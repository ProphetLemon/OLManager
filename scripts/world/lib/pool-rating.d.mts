import type { SkillEstimate, GameRow } from "../../stats/lib/skill.mjs";

export const GAME_POSITION: Readonly<Record<string, string>>;
export const TIER_OFFSETS: Readonly<Record<1 | 2 | 3, number>>;
export const RATING_STATS: "stats";
export const RATING_TIER_DEFAULT: "tier-default";
export const RATING_LEAGUE_DEFAULT: "league-default";
export const RATING_GAME_TIER_DEFAULT: "game-tier-default";
export const RATING_JUDGMENT_DEFAULT: "judgment-default";
export const JUDGMENT_DEFAULT_TIER: number;
export const STATS_MIN_GAMES: number;
/** The fewest games in the activity window that settle a player's position. */
export const POSITION_MIN_GAMES: number;
/** The role most of each player's games in the window were played in, with the games and the newest date. */
export function recentRolesFromRows(rows: Array<{ playerKey: string; role: string; date: string }>, options: { since: string }): Map<string, { position: string; games: number; last: string }>;
export const POOL_LEAGUE_SD: number;
export const POOL_MAX_CHANGE: number;

export interface Baselines {
  player(competition: string | null, position: string): { attributes: Record<string, number>; potential: number; range: Record<string, { min: number; max: number }> };
  /** Optional: the median of the real players of one tier in a role, or null when the tier has too few. */
  tierPlayer?(tier: number, position: string): { attributes: Record<string, number>; potential: number; range: Record<string, { min: number; max: number }> } | null;
  staff(role: string): { attributes: Record<string, number>; range: Record<string, { min: number; max: number }> };
}
export function tierBaselines(baselines: Baselines, tier: number): Baselines;

export type RatingFallbackReason = "no-stats" | "role-mismatch" | "below-min-games" | "no-estimate" | "no-league-level" | "no-mapped-league";
export type RatingSource = typeof RATING_STATS | typeof RATING_TIER_DEFAULT | typeof RATING_LEAGUE_DEFAULT | typeof RATING_GAME_TIER_DEFAULT | typeof RATING_JUDGMENT_DEFAULT;
/** The game's league ladder and the defaults of its rostered players (pool-anchors.mjs). */
export interface PoolAnchors {
  levels: Record<string, { median: number; sd: number }>;
  prefixes: Record<string, string[]>;
  leagueDefault: Record<string, { median: number; n: number }>;
  tierDefault: Record<string, { median: number; n: number }>;
  tierOf: Record<string, number>;
}
export interface PoolRating {
  source: RatingSource;
  /** Why a player fell back to a default; null for a stats rating. */
  reason: RatingFallbackReason | null;
  attributes: Record<string, number>;
  potential: number;
  /** round(mean of the nine attributes), as the game computes it. */
  ovr: number;
  /** Games behind a stats rating; null for a default. */
  games: number | null;
  /** The league whose level (stats) or default (league and game-tier defaults) was used; null without anchors and for the judgment default. */
  competition: string | null;
}
export function ratePoolPlayer(input: {
  tier: number;
  position: string;
  baselines: Baselines;
  estimate?: SkillEstimate | null;
  anchors?: PoolAnchors | null;
  competition?: string | null;
  seed?: { attributes: Record<string, number>; potential: number } | null;
}): PoolRating;
export function latestMappedCompetition(input: { tournaments: string[]; tournamentIndex: Map<string, { start?: string }>; anchors: Pick<PoolAnchors, "levels" | "prefixes"> }): string | null;
export function shapeBaselines(input: { baselines: Baselines; tier: number; anchors?: PoolAnchors | null; competition?: string | null }): Baselines;
export function poolSkillByPage(estimates: SkillEstimate[], positions: Map<string, string>): Map<string, SkillEstimate>;
export function poolSkillFromRows(rows: GameRow[], positions: Map<string, string>, options?: { poolOf?: (competition: string) => string | null | undefined }): Map<string, SkillEstimate>;
