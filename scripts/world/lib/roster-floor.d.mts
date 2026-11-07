import type { World } from "./world.mjs";
import type { OpEntry } from "./pipeline.mjs";

export const KEPT_FOR_ROSTER_FLOOR: string;
export function isRelease(op: Record<string, any>): boolean;
export function startingCounts(world: World): Map<string, number>;
export function rosterFloor(startingCount: number, minRosterSize: number): number;
export function applyRosterFloor(input: {
  world: World;
  players: OpEntry[];
  minRosterSize: number;
}): { players: OpEntry[]; skipped: Array<{ kind: string; subject: string; detail: string }> };
