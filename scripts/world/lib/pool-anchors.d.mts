import type { PoolAnchors } from "./pool-rating.mjs";

export const MIN_LEAGUE_DEFAULT_PLAYERS: number;
export function buildPoolAnchors(input: {
  levels: Record<string, { median: number; sd: number }>;
  records: Array<{ id: string; reason: string | null; competitionMismatch?: boolean }>;
  players: Array<{ id: string; team_id: string | null; competition: string | null; authoredOvr: number; isFlat50?: boolean; isAllZero?: boolean; attributes?: unknown }>;
  tierOf: Map<string, number>;
  prefixes: Record<string, string[]>;
}): PoolAnchors;
export function loadPoolAnchors(input: {
  rowsFile: string;
  indexFile?: string;
  dataDir: string;
  overlayFile?: string | null;
  teamMapFile: string;
  pinsFile?: string | null;
  prefixMapFile: string;
  tierOf: Map<string, number>;
}): PoolAnchors;
