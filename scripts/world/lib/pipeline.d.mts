import type { MediaWikiClient } from "./mediawiki-client.mjs";
import type { GateExceptions, GateResult } from "./gates.mjs";
import type { World } from "./world.mjs";
import type { RosterOverlay } from "./overlay-schema.mjs";

export interface OpEntry {
  op: Record<string, any>;
  id: string;
  teamId: string | null;
  competition: string | null;
  note: string;
}
export interface RefreshResult {
  overlay: RosterOverlay;
  gates: { ok: boolean; results: GateResult[] };
  report: string;
  world: World;
  summary: { players: number; staff: number; unmapped: number; unreadable: number; coverage: string[] };
  warnings: string[];
  ops: { players: OpEntry[]; staff: OpEntry[]; skipped: Array<{ kind: string; subject: string; detail: string }> };
}
export function loadIdMap(file: string | undefined): Record<string, any>;
export function fetchTeamRoster(client: MediaWikiClient, title: string): Promise<{ error?: string; players: any[]; staff: any[] }>;
export function runRefresh(options: {
  dataDir: string;
  teamMapPath: string;
  idMapPath?: string;
  competitions?: string[];
  client: MediaWikiClient;
  asOf?: string;
  gateOptions?: Record<string, number>;
  gateExceptions?: GateExceptions;
  log?: (message: string) => void;
}): Promise<RefreshResult>;
