import type { PoolInputs } from "./pool-fetch.mjs";
import type { PoolSelection } from "./pool.mjs";
import type { Tournament, TournamentClass } from "./pool-scope.mjs";

export const REFUSED_LINES_PER_REASON: number;
export const SAMPLE_PLAYERS_PER_REGION: number;
export const SAMPLE_STAFF_PER_REGION: number;
export interface ProbeExplanation {
  page: string;
  included: boolean;
  id: string | null;
  verdict: string;
  entries: Array<Record<string, any>>;
}
export function explainProbe(input: {
  probe: { page: string; entries: Array<{ page: string; role: string }> | null };
  tournaments: Tournament[];
  classes: Map<string, TournamentClass>;
  entryCount: Map<string, number>;
  cap: number;
  since: string;
  selection: PoolSelection;
}): ProbeExplanation;
export function summarizePool(selection: PoolSelection): {
  players: number;
  staff: number;
  playersByRole: Map<string, number>;
  playersByRegion: Map<string, number>;
  playersByLevel: Map<string, number>;
  playersByTier: Map<string, number>;
  staffByKind: Map<string, number>;
  staffByRegion: Map<string, number>;
  staffByLevel: Map<string, number>;
};
export function renderPoolSection(pool: {
  settings: { since: string; cap: number };
  inputs: PoolInputs;
  selection: PoolSelection;
  limits: { players: number; staff: number; overlayBytes: number };
  bytes: number;
  probe: ProbeExplanation | null;
}): string[];
