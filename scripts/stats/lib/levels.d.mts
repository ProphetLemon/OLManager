export interface LeagueLevel {
  median: number;
  sd: number;
}
export const POOL_BUCKET: number;
export function median(values: number[]): number;
export function populationSd(values: number[]): number;
export function leagueLevels(
  players: Array<{ competition: string | null; team_id: string | null; authoredOvr: number; isFlat50: boolean; isAllZero: boolean }>,
): Record<string, LeagueLevel>;
export function poolOfLevels(levels: Record<string, LeagueLevel>, bucket?: number): (competition: string) => string | null;
