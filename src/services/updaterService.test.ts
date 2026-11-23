import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/common/appInfo", () => ({ APP_VERSION: "2026.1122.1" }));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

import {
  checkForUpdate,
  downloadAndInstallUpdate,
  isNewerVersion,
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

  describe("on Android", () => {
    const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 6)";

    it("throws NoPlatformBuildError for a newer release, without the plugin", async () => {
      mocks.invoke.mockResolvedValue("2026.1123.1");
      await expect(checkForUpdate(ANDROID)).rejects.toMatchObject({
        name: "NoPlatformBuildError",
      });
      expect(mocks.invoke).toHaveBeenCalledWith("latest_release_version");
      expect(mocks.check).not.toHaveBeenCalled();
    });

    it("returns null at the same version", async () => {
      mocks.invoke.mockResolvedValue("2026.1122.1");
      await expect(checkForUpdate(ANDROID)).resolves.toBeNull();
      expect(mocks.check).not.toHaveBeenCalled();
    });

    it("returns null when the published version is older", async () => {
      mocks.invoke.mockResolvedValue("2026.1116.1");
      await expect(checkForUpdate(ANDROID)).resolves.toBeNull();
    });

    it("treats a missing release (404) as no update, like desktop", async () => {
      mocks.invoke.mockRejectedValue("release check failed: HTTP 404");
      await expect(checkForUpdate(ANDROID)).resolves.toBeNull();
      expect(mocks.check).not.toHaveBeenCalled();
    });

    it("re-throws a failed lookup", async () => {
      mocks.invoke.mockRejectedValue("release check failed: offline");
      await expect(checkForUpdate(ANDROID)).rejects.toBe("release check failed: offline");
      expect(mocks.check).not.toHaveBeenCalled();
    });
  });

  it("keeps the plugin check() with no arguments on desktop", async () => {
    mocks.check.mockResolvedValue(null);
    await expect(checkForUpdate("Mozilla/5.0 (X11; Linux x86_64)")).resolves.toBeNull();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.check).toHaveBeenCalledWith();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("isNewerVersion", () => {
  it.each([
    ["2026.1123.1", "2026.1122.1"],
    ["2026.1122.2", "2026.1122.1"],
    ["2027.101.1", "2026.1231.9"],
    ["2026.1122.1.1", "2026.1122.1"],
    ["2026.1122", "2026.1121.9"],
  ])("%s is newer than %s", (candidate, current) => {
    expect(isNewerVersion(candidate, current)).toBe(true);
  });

  it.each([
    ["2026.1122.1", "2026.1122.1"],
    ["2026.1122", "2026.1122.0"],
    ["2026.1121.9", "2026.1122.1"],
    ["2026.1122.1", "2026.1122.1.1"],
  ])("%s is not newer than %s", (candidate, current) => {
    expect(isNewerVersion(candidate, current)).toBe(false);
  });

  it("compares segments as numbers, not text", () => {
    expect(isNewerVersion("2026.1122.10", "2026.1122.9")).toBe(true);
  });

  it("tolerates a leading v on either side", () => {
    expect(isNewerVersion("v2026.1123.1", "2026.1122.1")).toBe(true);
    expect(isNewerVersion("2026.1123.1", "v2026.1122.1")).toBe(true);
    expect(isNewerVersion("v2026.1122.1", "2026.1122.1")).toBe(false);
  });

  it.each([
    ["", "2026.1122.1"],
    ["garbage", "2026.1122.1"],
    ["2026.1123.x", "2026.1122.1"],
    ["2026.1123.1-beta", "2026.1122.1"],
    ["2026..1", "2026.1122.1"],
    ["2026.1123.1", "garbage"],
  ])("returns false for unparsable input (%s vs %s)", (candidate, current) => {
    expect(isNewerVersion(candidate, current)).toBe(false);
  });
});
