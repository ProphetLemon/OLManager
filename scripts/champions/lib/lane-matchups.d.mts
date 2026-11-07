export interface ScoreboardRow {
  gameId: string;
  champion: string;
  role: string;
  win: boolean;
}
export interface Matchup {
  role: string;
  source: string;
  target: string;
  games: number;
  wins: number;
}
export interface CounterCandidate extends Matchup {
  winRate: number;
  value: number;
}
export interface CandidateOptions {
  minGames?: number;
  minWinRate?: number;
}
export const DEFAULT_MIN_GAMES: number;
export const DEFAULT_MIN_WIN_RATE: number;
export function canonicalChampionId(value: string): string;
export function canonicalRole(value: string): string | null;
export function aggregateLaneMatchups(rows: ScoreboardRow[]): { matchups: Matchup[]; skipped: number; laneGames: number };
export function strengthForWinRate(winRate: number): number | null;
export function deriveCounterCandidates(matchups: Matchup[], options?: CandidateOptions): CounterCandidate[];
export function findContradictions(
  curated: { source: string; target: string; value: number }[],
  matchups: Matchup[],
  options?: CandidateOptions,
): { source: string; target: string; value: number; against: CounterCandidate }[];
export function roleDistribution(rows: ScoreboardRow[]): Record<string, Record<string, number>>;
