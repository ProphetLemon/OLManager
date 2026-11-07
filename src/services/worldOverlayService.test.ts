import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { getWorldOverlayInfo, updateWorldOverlay } from "./worldOverlayService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("worldOverlayService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("reads the overlay a new game would use", async () => {
    const info = { as_of: "2026-06-22" };
    mockedInvoke.mockResolvedValueOnce(info);

    await expect(getWorldOverlayInfo()).resolves.toBe(info);
    expect(mockedInvoke).toHaveBeenCalledWith("get_world_overlay_info");
  });

  it("calls the update command and surfaces its rejection", async () => {
    mockedInvoke.mockRejectedValueOnce("download failed");

    await expect(updateWorldOverlay()).rejects.toBe("download failed");
    expect(mockedInvoke).toHaveBeenCalledWith("update_world_overlay");
  });
});
