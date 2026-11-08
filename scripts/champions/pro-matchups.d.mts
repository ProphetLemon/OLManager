import type { ScoreboardRow } from "./lib/lane-matchups.mjs";

export function scoreboardParams(options: { since: string; until: string; offset: number; pageSize: number }): Record<string, string>;
export function rowsFromCargo(data: { cargoquery?: { title: Record<string, string> }[] }): ScoreboardRow[];
export const MAX_PAGE_SIZE: number;
export function clampPageSize(value: unknown): number;
export function fetchAllRows(
  client: { get(params: Record<string, string>): Promise<{ cargoquery?: { title: Record<string, string> }[] }> },
  args: { since: string; until: string; pageSize: number },
): Promise<ScoreboardRow[]>;
export function parseArgs(argv: string[]): {
  since: string;
  until: string;
  offline: boolean;
  login: boolean;
  help: boolean;
  cacheDir: string;
  out: string;
  minGames: number;
  minLowerBound: number;
  maxRequests: number;
  pageSize: number;
};
