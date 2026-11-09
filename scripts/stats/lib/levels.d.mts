export interface LeagueLevel {
  median: number;
  sd: number;
}
export interface LeagueLevelCounts {
  n_used: number;
  n_excluded: number;
}
export const POOL_BUCKET: number;
export function median(values: number[]): number;
export function populationSd(values: number[]): number;
type LevelPlayer = { competition: string | null; team_id: string | null; authoredOvr: number; isFlat50: boolean; isAllZero: boolean; attributes?: unknown };
export function leagueLevels(players: LevelPlayer[]): Record<string, LeagueLevel>;
export function leagueLevelStats(players: LevelPlayer[]): { levels: Record<string, LeagueLevel>; counts: Record<string, LeagueLevelCounts> };
export function poolOfLevels(levels: Record<string, LeagueLevel>, bucket?: number): (competition: string) => string | null;
