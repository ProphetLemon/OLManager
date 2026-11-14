import type { OpEntry } from "./pipeline.mjs";
import type { World } from "./world.mjs";
import type { Baselines } from "./pool-rating.mjs";

export function buildOps(input: {
  world: World;
  analysis: unknown;
  statuses: Map<string, unknown>;
  infoboxes: Map<string, unknown>;
  baselines: Baselines;
}): { players: OpEntry[]; staff: OpEntry[]; skipped: Array<{ kind: string; subject: string; detail: string }> };
export function isWorldTeamName(name: string, worldTeamNames: Set<string>): boolean;
export function decideAbsentPlayer(
  player: { id: string; match_name: string },
  status: unknown,
  worldTeamNames: Set<string>,
): { op: Record<string, any>; note: string } | { skip: string };
