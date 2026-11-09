export const MEASURED_ALWAYS: readonly string[];
export const MEASURED_WITH_GAMES: readonly string[];
export const MIN_GAMES_FOR_SOFT: number;
export const SKILL_CARRY: number;

export interface DerivedAttributes {
  attributes: Record<string, number>;
  /** round(mean of the nine attributes), as calculate_lol_ovr computes it. */
  newOvr: number;
  /** max(newOvr, authored potential_base), 1..99. */
  potentialFloor: number;
  /** Attributes that took the full delta, in attribute order. */
  measured: string[];
  /** finalOvr - authoredOvr. */
  delta: number;
}
export function deriveAttributes(input: {
  attributes: Record<string, number>;
  authoredOvr: number;
  finalOvr: number;
  games: number;
  potentialBase: number;
  minGamesForSoft?: number;
  skillCarry?: number;
}): DerivedAttributes;
