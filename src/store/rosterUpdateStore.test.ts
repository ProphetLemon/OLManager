import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorldOverlayInfo } from "@/services/worldOverlayService";

const mocks = vi.hoisted(() => ({
  getWorldOverlayInfo: vi.fn(),
  updateWorldOverlay: vi.fn(),
}));

vi.mock("@/services/worldOverlayService", () => ({
  getWorldOverlayInfo: mocks.getWorldOverlayInfo,
  updateWorldOverlay: mocks.updateWorldOverlay,
}));

import {
  ROSTER_RECHECK_AFTER_MS,
  checkForRosterUpdates,
  recheckRostersIfStale,
  resetRosterUpdatesForTests,
  retryRosterCheck,
  startRosterLaunchCheck,
  useRosterUpdateStore,
} from "./rosterUpdateStore";

function makeInfo(overrides: Partial<WorldOverlayInfo> = {}): WorldOverlayInfo {
  return {
    as_of: "2026-06-22",
    origin: "bundled",
    source: {
      name: "Leaguepedia",
      url: "https://lol.fandom.com",
      license: "CC BY-SA 3.0",
      license_url: "https://www.fandom.com/licensing",
      attribution: "Roster data from Leaguepedia, available under CC BY-SA 3.0.",
    },
    player_ops: 12,
    staff_ops: 3,
    updated: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const state = () => useRosterUpdateStore.getState();
const HOUR = ROSTER_RECHECK_AFTER_MS;
const NOW = 10 * HOUR;

describe("rosterUpdateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRosterUpdatesForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getWorldOverlayInfo.mockResolvedValue(makeInfo());
    mocks.updateWorldOverlay.mockResolvedValue(makeInfo());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("launch check", () => {
    it("checks once per session, on the short automatic path", async () => {
      startRosterLaunchCheck();
      startRosterLaunchCheck();

      await vi.waitFor(() => expect(state().status).toBe("upToDate"));
      startRosterLaunchCheck();

      expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
      expect(mocks.updateWorldOverlay).toHaveBeenCalledWith({ automatic: true });
    });

    it("does not block: the check runs in the background as 'checking'", () => {
      mocks.updateWorldOverlay.mockReturnValue(deferred<WorldOverlayInfo>().promise);

      expect(startRosterLaunchCheck()).toBeUndefined();

      expect(state().status).toBe("checking");
    });

    it("loads the date a new game would use while the check runs", async () => {
      mocks.updateWorldOverlay.mockReturnValue(deferred<WorldOverlayInfo>().promise);

      startRosterLaunchCheck();

      await vi.waitFor(() => expect(state().info?.as_of).toBe("2026-06-22"));
      expect(state().status).toBe("checking");
    });

    it("keeps a finished check's overlay over a late info read", async () => {
      const lateInfo = deferred<WorldOverlayInfo>();
      mocks.getWorldOverlayInfo.mockReturnValue(lateInfo.promise);
      mocks.updateWorldOverlay.mockResolvedValue(
        makeInfo({ as_of: "2026-11-01", origin: "downloaded", updated: true }),
      );

      startRosterLaunchCheck();
      await vi.waitFor(() => expect(state().status).toBe("updated"));
      lateInfo.resolve(makeInfo());
      await lateInfo.promise;
      await Promise.resolve();

      expect(state().info?.as_of).toBe("2026-11-01");
    });
  });

  describe("check outcomes", () => {
    it("records an update with the new date and when it finished", async () => {
      vi.spyOn(Date, "now").mockReturnValue(NOW);
      mocks.updateWorldOverlay.mockResolvedValue(
        makeInfo({ as_of: "2026-11-01", origin: "downloaded", updated: true }),
      );

      await checkForRosterUpdates();

      expect(state().status).toBe("updated");
      expect(state().info?.as_of).toBe("2026-11-01");
      expect(state().lastCheckedAt).toBe(NOW);
    });

    it("records an unchanged overlay as up to date", async () => {
      await checkForRosterUpdates();

      expect(state().status).toBe("upToDate");
      expect(state().info?.as_of).toBe("2026-06-22");
    });

    it("records a failure and keeps the known date", async () => {
      vi.spyOn(Date, "now").mockReturnValue(NOW);
      useRosterUpdateStore.setState({ info: makeInfo() });
      mocks.updateWorldOverlay.mockRejectedValue("roster overlay download failed: offline");

      await checkForRosterUpdates();

      expect(state().status).toBe("failed");
      expect(state().info?.as_of).toBe("2026-06-22");
      expect(state().lastCheckedAt).toBe(NOW);
    });

    it("treats a missing answer as a failure", async () => {
      mocks.updateWorldOverlay.mockResolvedValue(undefined);

      await checkForRosterUpdates();

      expect(state().status).toBe("failed");
    });

    it("never runs two checks at once", async () => {
      const pending = deferred<WorldOverlayInfo>();
      mocks.updateWorldOverlay.mockReturnValue(pending.promise);

      const first = checkForRosterUpdates();
      const second = retryRosterCheck();

      expect(second).toBe(first);
      expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
      pending.resolve(makeInfo());
      await first;
    });
  });

  describe("retry", () => {
    it("uses the manual (long timeout) path and clears the failure on success", async () => {
      mocks.updateWorldOverlay.mockRejectedValueOnce("offline");
      await checkForRosterUpdates();
      expect(state().status).toBe("failed");

      await retryRosterCheck();

      expect(mocks.updateWorldOverlay).toHaveBeenLastCalledWith();
      expect(state().status).toBe("upToDate");
    });
  });

  describe("team screen re-check", () => {
    it("does not re-check after a success less than an hour ago", () => {
      useRosterUpdateStore.setState({ status: "upToDate", info: makeInfo(), lastCheckedAt: NOW - HOUR + 1 });

      recheckRostersIfStale(NOW);

      expect(mocks.updateWorldOverlay).not.toHaveBeenCalled();
    });

    it("does not re-check a recent update either", () => {
      useRosterUpdateStore.setState({ status: "updated", info: makeInfo(), lastCheckedAt: NOW - 1 });

      recheckRostersIfStale(NOW);

      expect(mocks.updateWorldOverlay).not.toHaveBeenCalled();
    });

    it("re-checks automatically when the last success is more than an hour old", () => {
      useRosterUpdateStore.setState({ status: "upToDate", info: makeInfo(), lastCheckedAt: NOW - HOUR - 1 });

      recheckRostersIfStale(NOW);

      expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
      expect(mocks.updateWorldOverlay).toHaveBeenCalledWith({ automatic: true });
    });

    it("re-checks after a failure, however recent", () => {
      useRosterUpdateStore.setState({ status: "failed", info: makeInfo(), lastCheckedAt: NOW - 1 });

      recheckRostersIfStale(NOW);

      expect(mocks.updateWorldOverlay).toHaveBeenCalledWith({ automatic: true });
    });

    it("checks when no check has run yet", () => {
      recheckRostersIfStale(NOW);

      expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
    });

    it("never starts a check while one is running", () => {
      mocks.updateWorldOverlay.mockReturnValue(deferred<WorldOverlayInfo>().promise);
      startRosterLaunchCheck();

      recheckRostersIfStale(NOW + 2 * HOUR);

      expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
    });

    it("reads the date when it is still unknown", async () => {
      useRosterUpdateStore.setState({ status: "upToDate", info: null, lastCheckedAt: NOW - 1 });

      recheckRostersIfStale(NOW);

      await vi.waitFor(() => expect(state().info?.as_of).toBe("2026-06-22"));
      expect(mocks.updateWorldOverlay).not.toHaveBeenCalled();
    });
  });
});
