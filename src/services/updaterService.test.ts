import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

import {
  checkForUpdate,
  downloadAndInstallUpdate,
  isNoPlatformBuildError,
  isNoReleaseError,
  needsManualRelaunch,
} from "./updaterService";

function fakeUpdate() {
  return {
    version: "0.4.0",
    body: "notes",
    date: "2026-11-08T10:00:00Z",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}

describe("updaterService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a missing latest.json (no release yet) as no update", async () => {
    mocks.check.mockRejectedValue(
      "Could not fetch a valid release JSON from the remote",
    );
    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it("still surfaces other failures such as a signature or network error", async () => {
    mocks.check.mockRejectedValue(new Error("error sending request for url"));
    await expect(checkForUpdate()).rejects.toThrow("error sending request");
  });

  it("tells a platform missing from latest.json apart from no release", async () => {
    const message =
      "the platform `windows-x86_64` was not found in the response `platforms` object";
    expect(isNoPlatformBuildError(new Error(message))).toBe(true);
    expect(isNoPlatformBuildError(new Error("status code 404 Not Found"))).toBe(false);
    mocks.check.mockRejectedValue(new Error(message));
    await expect(checkForUpdate()).rejects.toMatchObject({ name: "NoPlatformBuildError" });
  });

  it("recognises the fallback-platforms error of tauri-plugin-updater", async () => {
    const message =
      'None of the fallback platforms `["windows-x86_64-nsis", "windows-x86_64"]` were found in the response `platforms` object';
    expect(isNoPlatformBuildError(new Error(message))).toBe(true);
    expect(isNoReleaseError(new Error(message))).toBe(false);
    mocks.check.mockRejectedValue(new Error(message));
    await expect(checkForUpdate()).rejects.toMatchObject({ name: "NoPlatformBuildError" });
  });

  it("recognises the no-release errors only", () => {
    expect(isNoReleaseError("Could not fetch a valid release JSON from the remote")).toBe(true);
    expect(isNoReleaseError(new Error("status code 404 Not Found"))).toBe(true);
    expect(isNoReleaseError(new Error("signature verification failed"))).toBe(false);
  });

  it("relaunches after installing on platforms whose installer does not restart the app", async () => {
    const update = fakeUpdate();
    mocks.check.mockResolvedValue(update);
    await downloadAndInstallUpdate(undefined, "Linux x86_64");
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
  });

  it("leaves the relaunch to the passive NSIS installer on Windows", async () => {
    const update = fakeUpdate();
    mocks.check.mockResolvedValue(update);
    await downloadAndInstallUpdate(undefined, "Windows NT 10.0");
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("decides the relaunch from the platform string", () => {
    expect(needsManualRelaunch("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(needsManualRelaunch("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(true);
  });
});
