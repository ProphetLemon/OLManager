import type { GameRow } from "./lib/skill.mjs";
import type { RawRow } from "./lib/queries.mjs";
import type { MediaWikiClient } from "../world/lib/mediawiki-client.mjs";

export const SOURCE: string;

export interface PrefixMap {
  version: number;
  note?: string;
  competitions: Record<string, string[]>;
  open?: Record<string, string>;
}
export interface ProStatsArgs {
  since: string;
  until: string;
  competitions: string[];
  offline: boolean;
  login: boolean;
  cacheDir: string;
  out: string;
  maxRequests: number;
  pageSize: number;
  help: boolean;
}
export interface CompetitionCoverage {
  games: number;
  rows: number;
  players: number;
  inputRows: number;
  dropped: Record<string, number>;
}
export interface Coverage {
  source: string;
  since: string;
  until: string;
  competitions: Record<string, CompetitionCoverage>;
  totals: { rows: number; games: number; inputRows: number };
  open: Record<string, string>;
  network: unknown;
}

export function loadPrefixMap(file?: string): PrefixMap;
export function parseArgs(argv: string[], prefixMap?: PrefixMap): ProStatsArgs;
export function fetchCompetitionRows(
  client: Pick<MediaWikiClient, "get">,
  options: { prefixes: string[]; since: string; until: string; pageSize: number; log?: (message: string) => void },
): Promise<RawRow[]>;
export function coveragePath(out: string): string;
export function runProStats(
  args: ProStatsArgs,
  client: Pick<MediaWikiClient, "get"> & Partial<Pick<MediaWikiClient, "stats" | "statsSnapshot">>,
  log: (message: string) => void,
  prefixMap?: PrefixMap,
): Promise<{ rows: GameRow[]; coverage: Coverage }>;
