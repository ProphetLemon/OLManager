export interface CounterCurationChange {
  op: "remove" | "add" | "set";
  source: string;
  target: string;
  value?: number;
  confidence: string;
  reason: string;
  basis?: CurationBasis;
}
export type CurationBasis = "general_knowledge" | "pro_play_stats";
export interface CounterCuration {
  metadata: { schemaVersion: 1; basis: string; reviewed_at: string; method: string };
  changes: CounterCurationChange[];
}
export interface CuratedCounter {
  source: string;
  target: string;
  value: number;
  curated: { op: "add" | "set"; confidence: string; reason: string; basis: CurationBasis } | null;
}
export const CURATION_SOURCE: string;
export function validateCuration(curation: CounterCuration): CounterCuration;
export function applyCounterCuration(
  legacyCounters: ReadonlyArray<{ source: string; target: string; value: number }>,
  curation: CounterCuration,
): { counters: CuratedCounter[]; summary: { remove: number; add: number; set: number } };
export function validateCounterSet(
  counters: ReadonlyArray<{ source: string; target: string; value: number }>,
  knownIds: ReadonlySet<string>,
): void;
