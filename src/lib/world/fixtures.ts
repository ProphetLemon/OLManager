import { fileURLToPath } from "node:url";

const fixture = (relative: string) => fileURLToPath(new URL(`../../../scripts/world/fixtures/${relative}`, import.meta.url));

/** Recorded Leaguepedia responses + a small game world for LCK/LEC (see scripts/world/README.md). */
export const FIXTURES = {
  dataDir: fixture("data"),
  cacheDir: fixture("cache"),
  teamMap: fixture("team-map.json"),
  idMap: fixture("id-map.json"),
};
