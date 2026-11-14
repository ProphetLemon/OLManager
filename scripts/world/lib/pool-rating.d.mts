import type { SkillEstimate, GameRow } from "../../stats/lib/skill.mjs";

export const GAME_POSITION: Readonly<Record<string, string>>;
export const TIER_OFFSETS: Readonly<Record<1 | 2 | 3, number>>;
export const RATING_STATS: "stats";
export const RATING_TIER_DEFAULT: "tier-default";
export const STATS_MIN_GAMES: number;
export const POOL_LEAGUE_SD: number;
export const POOL_MAX_CHANGE: number;

export interface Baselines {
  player(competition: string | null, position: string): { attributes: Record<string, number>; potential: number; range: Record<string, { min: number; max: number }> };
  staff(role: string): { attributes: Record<string, number>; range: Record<string, { min: number; max: number }> };
}
export function tierBaselines(baselines: Baselines, tier: number): Baselines;

export type RatingFallbackReason = "no-stats" | "role-mismatch" | "below-min-games" | "no-estimate";
export interface PoolRating {
  source: typeof RATING_STATS | typeof RATING_TIER_DEFAULT;
  /** Why a player fell back to the tier default; null for a stats rating. */
  reason: RatingFallbackReason | null;
  attributes: Record<string, number>;
  potential: number;
  /** round(mean of the nine attributes), as the game computes it. */
  ovr: number;
  /** Games behind a stats rating; null for the tier default. */
  games: number | null;
}
export function ratePoolPlayer(input: { tier: number; position: string; baselines: Baselines; estimate?: SkillEstimate | null }): PoolRating;
export function poolSkillByPage(estimates: SkillEstimate[], positions: Map<string, string>): Map<string, SkillEstimate>;
export function poolSkillFromRows(rows: GameRow[], positions: Map<string, string>): Map<string, SkillEstimate>;
