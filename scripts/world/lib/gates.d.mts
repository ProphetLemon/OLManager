import type { World } from "./world.mjs";

export interface GateResult {
  name: string;
  scope: string;
  ok: boolean;
  detail: string;
  value: unknown;
}
export const DEFAULT_GATE_OPTIONS: Readonly<{ minRosterSize: number; maxChangedShare: number; maxAddsPerTeam: number }>;
export function simulateRosterCounts(world: World, playerOps: unknown[]): Map<string, number>;
export function runGates(input: {
  overlay: any;
  world: World;
  coveredTeamIds: Set<string>;
  options?: Partial<{ minRosterSize: number; maxChangedShare: number; maxAddsPerTeam: number }>;
}): { ok: boolean; results: GateResult[] };
