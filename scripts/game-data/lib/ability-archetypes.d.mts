export type ArchetypeName =
  | "ally_shield"
  | "ally_heal"
  | "self_shield"
  | "self_heal"
  | "dash"
  | "engage"
  | "hard_cc"
  | "poke"
  | "execute"
  | "stealth"
  | "untargetable"
  | "global";
export type RangeClass = "self" | "melee" | "short" | "medium" | "long" | "global";
export type Slot = "Q" | "W" | "E" | "R";

export const ARCHETYPES: Record<ArchetypeName, string>;
export const ARCHETYPE_NAMES: ArchetypeName[];
export const RANGE_CLASSES: RangeClass[];
export const SLOTS: Slot[];
export const RANGE_THRESHOLDS: Readonly<{ selfMax: number; meleeMax: number; shortMax: number; mediumMax: number; globalMin: number }>;
export const POKE_MIN_RANGE: number;

export interface AbilityInput {
  description?: string;
  range?: number[];
}
export interface KitAbility extends AbilityInput {
  slot: string;
  name: string;
  cooldown: number[];
}
export interface KitsInput {
  patch: string;
  date: string;
  champions: Record<string, { abilities: KitAbility[] }>;
}
export type CuratedEntry = ArchetypeName[] | { archetypes?: ArchetypeName[]; rangeClass?: RangeClass };
export interface CuratedInput {
  overrides: Record<string, Partial<Record<Slot, CuratedEntry>>>;
}
export interface AbilityEntry {
  slot: Slot;
  name: string;
  archetypes: ArchetypeName[];
  cooldownSec: number | null;
  rangeClass: RangeClass;
  origin: "rule" | "curated";
}
export interface AbilitiesFile {
  schema: string;
  patch: string;
  date: string;
  source: string;
  generator: string;
  cooldownSec: string;
  rangeClass: { rule: string; thresholds: Record<string, number>; classes: Record<RangeClass, string> };
  pokeMinRange: number;
  origin: Record<string, string>;
  archetypes: Record<ArchetypeName, string>;
  champions: Record<string, AbilityEntry[]>;
}
export interface AbilitiesReport {
  champions: number;
  abilities: number;
  curated: number;
  ruleOnly: number;
  championsPerArchetype: Record<ArchetypeName, number>;
}

export function cooldownAtMiddleRank(cooldowns: number[] | undefined): number | null;
export function rangeAtMiddleRank(ranges: number[] | undefined): number | null;
export function classifyRange(ranges: number[] | undefined, description?: string, archetypes?: ArchetypeName[]): RangeClass;
export function classifyAbilityText(ability: AbilityInput): ArchetypeName[];
export function curatedParts(entry: CuratedEntry): { archetypes: ArchetypeName[] | undefined; rangeClass: RangeClass | undefined };
export function validateCurated(
  curated: CuratedInput,
  kitChampions: KitsInput["champions"],
  ruleOutput: (championId: string, slot: string) => { archetypes: ArchetypeName[]; rangeClass: RangeClass },
): void;
export function buildAbilities(input: { kits: KitsInput; curated: CuratedInput }): { file: AbilitiesFile; report: AbilitiesReport };
