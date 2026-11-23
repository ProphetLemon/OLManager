import { check, Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { APP_VERSION } from "@/lib/common/appInfo";

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

/** Parses `2026.1122.1` (an optional leading `v` is tolerated) into numbers, or null. */
function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(value.trim());
  return match ? match[1].split(".").map(Number) : null;
}

/**
 * True when `candidate` is a strictly newer dotted numeric version than
 * `current`. Segments compare as numbers and a missing one counts as 0.
 * Anything unparsable returns false, so a malformed manifest shows no notice.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * Android cannot use the updater plugin: tauri-plugin-updater has no Android
 * target ("Unsupported OS"), and forcing one makes its reqwest 0.13 client panic
 * ("Expect rustls-platform-verifier to be initialized"). The app's own HTTP
 * client reads the same `latest.json` instead, and a newer version surfaces as
 * `NoPlatformBuildError` because the manifest has no Android build to install.
 */
async function checkForAndroidRelease(): Promise<null> {
  const latest = await invoke<string>("latest_release_version");
  if (isNewerVersion(latest, APP_VERSION)) {
    throw new NoPlatformBuildError(
      `Release ${latest} is available, but it has no build the app can install on Android`,
    );
  }
  return null;
}

export async function checkForUpdate(
  platform: string = currentPlatform(),
): Promise<UpdateInfo | null> {
  if (/Android/i.test(platform)) return checkForAndroidRelease();
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
