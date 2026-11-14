export const PLAYER_ATTRIBUTES: string[];
export const STAFF_ATTRIBUTES: string[];
export const JITTER: number;
export const MIN_TIER_ROLE_PLAYERS: number;
export class IdCollisionError extends Error {}
export function deterministicId(prefix: string, canonicalTitle: string): string;
export function seededJitter(seed: string, key: string, spread?: number): number;
export function approximateBirthDate(seed: string): string;
export interface Baselines {
  player(competition: string | null, position: string): { attributes: Record<string, number>; potential: number; range: Record<string, { min: number; max: number }> };
  /** Median of the real players of one tier in a role; null when the tier has fewer than MIN_TIER_ROLE_PLAYERS. */
  tierPlayer(tier: number, position: string): { attributes: Record<string, number>; potential: number; range: Record<string, { min: number; max: number }> } | null;
  staff(role: string): { attributes: Record<string, number>; range: Record<string, { min: number; max: number }> };
}
export function computeBaselines(world: unknown): Baselines;
export function generatePlayer(input: Record<string, any>): { record: Record<string, any>; dobApprox: boolean; nationalityMissing: boolean };
export function generateStaff(input: Record<string, any>): { record: Record<string, any>; dobApprox: boolean; nationalityMissing: boolean };
