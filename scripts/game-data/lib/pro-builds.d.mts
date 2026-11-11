import type { CatalogueItem } from "./ddragon-transform.mjs";

export const DEFAULT_MIN_GAMES: number;
export const BUILD_SIZE: number;
export const MAX_FREQUENCY_ENTRIES: number;
export const MAX_CORES: number;
export const CORE_SIZE: number;

export interface RawBuildRow {
  gameId: string | null;
  champion: string | null;
  role: string | null;
  win: boolean | null;
  items: string[];
  patch: string | null;
  date: string | null;
}
export interface BuildRow {
  gameId: string;
  champion: string;
  role: string;
  win: boolean;
  patch: string | null;
  date: string | null;
  boots: string[];
  finished: string[];
  other: string[];
  hasItems: boolean;
}
export interface PairAggregate {
  champion: string;
  role: string;
  games: number;
  wins: number;
  buildGames: number;
  items: Map<string, number>;
  boots: Map<string, number>;
  cores: Map<string, number>;
}
export interface RecommendedBuild {
  boots: string | null;
  items: string[];
}
export interface ChampionRoleEntry {
  games: number;
  wins: number;
  buildGames: number;
  build: RecommendedBuild | null;
  itemShare?: Record<string, number>;
  bootsShare?: Record<string, number>;
  commonCores?: { items: string[]; games: number }[];
  fallback?: "class";
  class?: string | null;
}

export function canonicalRole(value: unknown): string | null;
export function decodeEntities(text: unknown): string;
export function parseItemNames(raw: unknown): string[];
export function createChampionResolver(champions: { id: string; name: string }[]): (value: string) => string | null;
export function createItemResolver(items: CatalogueItem[]): (name: string) => CatalogueItem | null;
export function isFinishedItem(item: CatalogueItem): boolean;
export function normalizeRows(
  rawRows: RawBuildRow[],
  resolvers: { resolveChampion: (name: string) => string | null; resolveItem: (name: string) => CatalogueItem | null },
): {
  rows: BuildRow[];
  droppedRows: number;
  unresolvedChampions: { name: string; count: number }[];
  unmappedItems: { name: string; count: number }[];
};
export function aggregatePairs(rows: BuildRow[]): PairAggregate[];
export function recommendBuild(pair: PairAggregate, options?: { minGames?: number }): RecommendedBuild | null;
export function buildChampionEntries(
  pairs: PairAggregate[],
  options: { classOf: (id: string) => string | null; minGames?: number },
): { champions: Record<string, Record<string, ChampionRoleEntry>>; pairs: { total: number; withBuild: number; fallback: number } };
export function gamesByPatch(rows: BuildRow[]): Record<string, number>;
