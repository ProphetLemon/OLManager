export const DEFAULT_REPO: string;
export const WINDOWS_TARGET: string;
export const UPDATER_PLATFORM: string;
export const NSIS_HINT: string;
export function releaseAssetName(fileName: string): string;
export function encodeAssetName(assetName: string): string;
export function tagFor(version: string): string;
export function assetUrl(repo: string, version: string, assetName: string): string;
export function findInstaller(fileNames: string[], version: string): { setup: string; sig: string };
export interface LatestJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}
export function buildLatestJson(input: {
  version: string;
  notes: string;
  pubDate: string;
  signature: string;
  assetName: string;
  repo?: string;
}): LatestJson;
export function buildReleaseNotes(input: {
  version: string;
  commits: string[];
  previousTag: string | null;
}): string;
export function publishCommands(input: {
  version: string;
  repo?: string;
  files: string[];
  notesFile: string;
}): string[];
export function parseArgs(argv: string[]): { dryRun: boolean; notesFile: string | null; repo: string };
export function findOnPath(binary: string, pathVar?: string, exists?: (p: string) => boolean): string | null;
