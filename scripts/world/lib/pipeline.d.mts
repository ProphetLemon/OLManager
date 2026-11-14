import type { MediaWikiClient } from "./mediawiki-client.mjs";
import type { GateExceptions, GateResult } from "./gates.mjs";
import type { World } from "./world.mjs";
import type { RosterOverlay } from "./overlay-schema.mjs";
import type { PoolInputs } from "./pool-fetch.mjs";
import type { ProbeExplanation } from "./pool-report.mjs";
import type { PoolSelection } from "./pool.mjs";
import type { GameRow, SkillEstimate } from "../../stats/lib/skill.mjs";

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
  /** Present only when the run was asked for the active-pros pool. */
  pool?: {
    settings: { since: string; cap: number };
    inputs: PoolInputs;
    selection: PoolSelection;
    ops: { players: OpEntry[]; staff: OpEntry[] };
    probe: ProbeExplanation | null;
    bytes: number;
  };
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
  /** Opt-in active-pros pool; `inputs` replaces the Leaguepedia queries (tests). */
  pool?: {
    since?: string;
    cap?: number;
    probe?: string;
    inputs?: PoolInputs;
    /** Per-game rows of scripts/stats/pro-stats.mjs: players with enough games are rated from them. */
    statsRows?: GameRow[];
    /** Ready skill estimates by page, instead of `statsRows`. */
    skill?: Map<string, SkillEstimate>;
  };
  log?: (message: string) => void;
}): Promise<RefreshResult>;
