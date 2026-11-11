import type { RawBuildRow } from "./lib/pro-builds.mjs";

export const SOURCE: string;
export const FIELDS: string;
export const ORDER_BY: string;
export interface ProBuildsArgs {
  since: string | null;
  until: string | null;
  probe: boolean;
  offline: boolean;
  cacheDir: string;
  out: string;
  minGames: number;
  maxRequests: number;
  pageSize: number;
  help: boolean;
}
export function parseArgs(argv: string[]): ProBuildsArgs;
export function buildsParams(options: { since: string; until: string; offset: number; pageSize: number }): Record<string, string>;
export function rowsFromCargo(data: unknown): RawBuildRow[];
export function fetchAllRows(client: { get(params: Record<string, string>): Promise<unknown> }, args: { since: string; until: string; pageSize: number }, log?: (message: string) => void): Promise<RawBuildRow[]>;
export function buildFile(options: {
  rawRows: RawBuildRow[];
  items: unknown[];
  kits: Record<string, { id: string; name: string; tags?: string[] }>;
  catalogueIds: string[];
  args: { since: string | null; until: string | null; minGames: number };
  pulledAt: string;
  patch: string;
}): Record<string, unknown> & { champions: Record<string, Record<string, unknown>> };
