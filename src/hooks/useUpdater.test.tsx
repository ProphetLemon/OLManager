import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
}));

vi.mock("../services/updaterService", () => ({
  checkForUpdate: mocks.checkForUpdate,
  downloadAndInstallUpdate: mocks.downloadAndInstallUpdate,
}));

import { useUpdater } from "./useUpdater";

describe("useUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports download progress as a share of the total size", async () => {
    mocks.checkForUpdate.mockResolvedValue({ version: "0.4.0", notes: "", date: null });
    let finish: () => void = () => {};
    mocks.downloadAndInstallUpdate.mockImplementation(
      (onEvent: (e: unknown) => void) =>
        new Promise<void>((resolve) => {
          onEvent({ event: "Started", data: { contentLength: 1000 } });
          onEvent({ event: "Progress", data: { chunkLength: 100 } });
          onEvent({ event: "Progress", data: { chunkLength: 100 } });
          finish = resolve;
        }),
    );

    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.install();
    });
    await waitFor(() => expect(result.current.progress?.percent).toBe(20));
    await act(async () => {
      finish();
      await pending;
    });
  });

  it("keeps a failed startup check out of the way", async () => {
    mocks.checkForUpdate.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useUpdater(true));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.updateAvailable).toBe(false);
    expect(result.current.error).toBe("offline");
  });
});
