export interface AbilitiesArgs {
  kits: string;
  curated: string;
  out: string;
  check: boolean;
  help: boolean;
}
export function parseArgs(argv: string[]): AbilitiesArgs;
export function render(
  kits: import("./lib/ability-archetypes.mjs").KitsInput,
  curated: import("./lib/ability-archetypes.mjs").CuratedInput,
): { text: string; report: import("./lib/ability-archetypes.mjs").AbilitiesReport };
