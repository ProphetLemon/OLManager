export const SUMMONERS_RIFT_MAP: string;
export const VARIANT_ID_FLOOR: number;
export const ITEM_ICON_DIR: string;
export const ULTIMATE_ICON_DIR: string;

export interface ItemStatLine {
  value: string;
  stat: string;
}
export interface CatalogueItem {
  id: number;
  key: string;
  name: string;
  cost: number;
  baseCost: number;
  sellValue: number;
  stats: Record<string, number>;
  statLines: ItemStatLine[];
  tags: string[];
  buildsFrom: number[];
  buildsInto: number[];
  depth: number;
  boots: boolean;
  starter: boolean;
  consumable: boolean;
  trinket: boolean;
  support: boolean;
  icon: string;
}
export interface ItemFilterReport {
  rule: string;
  total: number;
  kept: number;
  dropped: number;
  droppedByReason: Record<string, number>;
  duplicateNames: { name: string; kept: string; dropped: string }[];
}
export interface KitAbility {
  slot: "Q" | "W" | "E" | "R";
  id: string;
  name: string;
  description: string;
  cooldown: number[];
  cost: number[];
  costType: string;
  range: number[];
  maxRank: number;
  image: string;
}
export interface ChampionKit {
  id: string;
  key: number;
  name: string;
  title: string;
  inCatalogue: boolean;
  tags: string[];
  resource: string;
  attackRange: number;
  stats: Record<string, number>;
  passive: { name: string; description: string; image: string };
  abilities: KitAbility[];
  ultimate: { archetype: string; icon: string };
}
export interface KitsReport {
  total: number;
  inCatalogue: number;
  notInCatalogue: string[];
  missingFromData: string[];
}
export interface FileHeader {
  schema: string;
  patch: string;
  date: string;
  locale: string;
  source: string;
  generator: string;
}

export function stripMarkup(text: unknown): string;
export function itemKey(name: string): string;
export function parseStatLines(description: unknown): ItemStatLine[];
export function dropReason(id: string | number, entry: unknown): string | null;
export function buildItems(itemJson: unknown): { items: CatalogueItem[]; filter: ItemFilterReport };
export function classifyUltimateArchetype(name: string, description: string): string;
export function buildKits(championFull: unknown, catalogueIds: Iterable<string>): { champions: Record<string, ChampionKit>; report: KitsReport };
export function buildHeader(options: { patch: string; date: string; kind: string; locale?: string }): FileHeader;
