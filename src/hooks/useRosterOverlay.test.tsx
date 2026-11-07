import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorldOverlayInfo } from "@/services/worldOverlayService";

const mocks = vi.hoisted(() => ({
  getWorldOverlayInfo: vi.fn(),
  updateWorldOverlay: vi.fn(),
}));

vi.mock("@/services/worldOverlayService", () => ({
  getWorldOverlayInfo: mocks.getWorldOverlayInfo,
  updateWorldOverlay: mocks.updateWorldOverlay,
}));

import { resetRosterAutoCheckForTests, useRosterOverlay } from "./useRosterOverlay";

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
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useRosterOverlay automatic check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRosterAutoCheckForTests();
    mocks.getWorldOverlayInfo.mockResolvedValue(makeInfo());
    mocks.updateWorldOverlay.mockResolvedValue(makeInfo());
  });

  it("does not check on its own unless asked to", async () => {
    const { result } = renderHook(() => useRosterOverlay());
    await waitFor(() => expect(result.current.info).not.toBeNull());

    expect(mocks.updateWorldOverlay).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("checks once on mount, flagged as automatic, and reports 'checking' meanwhile", async () => {
    const pending = deferred<WorldOverlayInfo>();
    mocks.updateWorldOverlay.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useRosterOverlay({ autoCheck: true }));

    await waitFor(() => expect(result.current.status).toBe("checking"));
    expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
    expect(mocks.updateWorldOverlay).toHaveBeenCalledWith({ automatic: true });

    await act(async () => pending.resolve(makeInfo()));
    await waitFor(() => expect(result.current.status).not.toBe("checking"));
  });

  it("does not check again when the screen is reopened in the same session", async () => {
    const first = renderHook(() => useRosterOverlay({ autoCheck: true }));
    await waitFor(() => expect(first.result.current.status).toBe("idle"));
    expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderHook(() => useRosterOverlay({ autoCheck: true }));
    await waitFor(() => expect(second.result.current.info).not.toBeNull());

    expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
    expect(second.result.current.status).toBe("idle");
  });

  it("keeps a reopened screen in 'checking' while the first check is still running", async () => {
    const pending = deferred<WorldOverlayInfo>();
    mocks.updateWorldOverlay.mockReturnValue(pending.promise);

    const first = renderHook(() => useRosterOverlay({ autoCheck: true }));
    await waitFor(() => expect(first.result.current.status).toBe("checking"));
    first.unmount();

    const second = renderHook(() => useRosterOverlay({ autoCheck: true }));
    await waitFor(() => expect(second.result.current.status).toBe("checking"));
    expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(makeInfo({ as_of: "2026-11-01", updated: true })));
    await waitFor(() => expect(second.result.current.status).toBe("updated"));
    expect(second.result.current.info?.as_of).toBe("2026-11-01");
  });

  it("reports an update found by the automatic check and stays quiet when up to date", async () => {
    mocks.updateWorldOverlay.mockResolvedValue(
      makeInfo({ as_of: "2026-11-01", origin: "downloaded", updated: true }),
    );
    const found = renderHook(() => useRosterOverlay({ autoCheck: true }));
    await waitFor(() => expect(found.result.current.status).toBe("updated"));
    expect(found.result.current.info?.as_of).toBe("2026-11-01");
    found.unmount();

    resetRosterAutoCheckForTests();
    mocks.updateWorldOverlay.mockResolvedValue(makeInfo({ updated: false }));
    const same = renderHook(() => useRosterOverlay({ autoCheck: true }));
    await waitFor(() => expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(same.result.current.status).toBe("idle"));
    expect(same.result.current.error).toBeNull();
  });

  it("turns an automatic failure into a quiet 'checkFailed' state without an error message", async () => {
    mocks.updateWorldOverlay.mockRejectedValue("roster overlay download failed: offline");

    const { result } = renderHook(() => useRosterOverlay({ autoCheck: true }));

    await waitFor(() => expect(result.current.status).toBe("checkFailed"));
    expect(result.current.error).toBeNull();
    expect(result.current.info?.as_of).toBe("2026-06-22");
  });

  it("lets the manual update run, as a manual call, after the automatic check", async () => {
    const { result } = renderHook(() => useRosterOverlay({ autoCheck: true }));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    mocks.updateWorldOverlay.mockResolvedValue(
      makeInfo({ as_of: "2026-11-02", origin: "downloaded", updated: true }),
    );

    await act(async () => {
      await result.current.update();
    });

    expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(2);
    expect(mocks.updateWorldOverlay).toHaveBeenLastCalledWith();
    expect(result.current.status).toBe("updated");
  });

  it("surfaces a manual failure as a loud error even after a quiet automatic one", async () => {
    mocks.updateWorldOverlay.mockRejectedValue("offline");
    const { result } = renderHook(() => useRosterOverlay({ autoCheck: true }));
    await waitFor(() => expect(result.current.status).toBe("checkFailed"));

    await act(async () => {
      await result.current.update();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("offline");
  });
});
