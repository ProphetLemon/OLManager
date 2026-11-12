import type { GateResult } from "./gates.mjs";
import type { POOL_LIMITS } from "./pool.mjs";
import type { World } from "./world.mjs";

export function runPoolGates(input: {
  overlay: { players?: any[]; staff?: any[] };
  world: World;
  overrides?: unknown;
  collisions?: Array<{ page: string; id: string; with: string }>;
  bytes: number;
  limits?: Partial<typeof POOL_LIMITS>;
}): GateResult[];
