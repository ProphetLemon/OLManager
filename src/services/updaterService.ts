import { check, Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update, DownloadEvent };

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
}

/**
 * The updater fails with these when the fork has not published a release yet
 * (`latest.json` answers 404 or is not valid JSON). That is "nothing to
 * update to", not an error worth showing the player.
 */
export function isNoReleaseError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /could not fetch a valid release json|\b404\b|not found/i.test(message);
}

/**
 * `latest.json` exists but has no entry for this platform: a release was
 * published without a build for the player's system.
 */
export function isNoPlatformBuildError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /platform .* not found|(?:not found|were found) in the response `platforms`/i.test(message);
}

export class NoPlatformBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoPlatformBuildError";
  }
}

/**
 * The passive NSIS installer closes the app and starts the new build itself on
 * Windows. Every other platform replaces the files in place and needs an
 * explicit relaunch.
 */
export function needsManualRelaunch(platform: string): boolean {
  return !/windows|win32/i.test(platform);
}

function currentPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  let update: Update | null;
  try {
    update = await check();
  } catch (err) {
    if (isNoPlatformBuildError(err)) {
      throw new NoPlatformBuildError(err instanceof Error ? err.message : String(err));
    }
    if (isNoReleaseError(err)) return null;
    throw err;
  }
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body || "",
    date: update.date || null,
  };
}

export async function downloadAndInstallUpdate(
  onEvent?: (event: DownloadEvent) => void,
  platform: string = currentPlatform(),
): Promise<void> {
  const update = await check();
  if (!update) throw new Error("No update available");
  await update.downloadAndInstall(onEvent);
  if (needsManualRelaunch(platform)) {
    await relaunch();
  }
}
