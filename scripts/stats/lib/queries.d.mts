export interface RawRow {
  overviewPage: string | null;
  gameId: string | null;
  link: string | null;
  name: string | null;
  team: string | null;
  role: string | null;
  side: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  gold: number | null;
  cs: number | null;
  damageToChampions: number | null;
  visionScore: number | null;
  teamKills: number | null;
  teamGold: number | null;
  dateTime: string | null;
  gameMinutes: number | null;
}

export const PREFIX_PATTERN: RegExp;
export const MAX_PREFIX_LENGTH: number;
export const MAX_PAGE_SIZE: number;
export const FIELDS: readonly (readonly [string, string])[];
export const ORDER_BY: string;

export function isValidIsoDate(value: unknown): boolean;
export function assertValidPrefix(prefix: unknown): asserts prefix is string;
export function sqlString(value: string): string;
export function buildWhere(options: { since: string; until: string; prefixes: string[] }): string;
export function scoreboardPageParams(options: {
  since: string;
  until: string;
  prefixes: string[];
  offset: number;
  pageSize: number;
}): Record<string, string>;
export function rowsFromCargo(data: { cargoquery?: { title: Record<string, string | undefined> }[] }): RawRow[];
