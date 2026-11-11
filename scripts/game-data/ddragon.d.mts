export const SUMMONER_SPELLS: Record<string, string>;
export interface DdragonArgs {
  version: string | null;
  offline: boolean;
  icons: boolean;
  cacheDir: string;
  outDir: string;
  iconsDir: string;
  throttleMs: number;
  maxRequests: number;
  help: boolean;
}
export function parseArgs(argv: string[]): DdragonArgs;
