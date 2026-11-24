import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { autoSave, setLiveMatchActive, useAutoSaveStore } from "./autoSave";
import { useGameStore, type GameStateData } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const game = { clock: { current_date: "2026-07-02" } } as unknown as GameStateData;

function setAutoSave(on: boolean): void {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, auto_save: on } });
}

describe("autoSave", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setAutoSave(true);
    setLiveMatchActive(false);
    useGameStore.setState({ gameState: game, isDirty: true });
    useAutoSaveStore.setState({ failed: false, savedCount: 0 });
  });

  it("does nothing when the setting is off", async () => {
    setAutoSave(false);
    await autoSave();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("saves an unsaved game once and marks it clean", async () => {
    await autoSave();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("save_game");
    expect(useGameStore.getState().isDirty).toBe(false);
    expect(useAutoSaveStore.getState().savedCount).toBe(1);
  });

  it("does nothing when nothing is unsaved", async () => {
    useGameStore.setState({ isDirty: false });
    await autoSave();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("does nothing when no game is loaded", async () => {
    useGameStore.setState({ gameState: null });
    await autoSave();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("does nothing while a live match is in progress", async () => {
    setLiveMatchActive(true);
    await autoSave();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("a failed save leaves the game unsaved and raises the failure notice, without throwing", async () => {
    mockedInvoke.mockRejectedValue("disk full");
    await expect(autoSave()).resolves.toBeUndefined();
    expect(useGameStore.getState().isDirty).toBe(true);
    expect(useAutoSaveStore.getState().failed).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("a later good save clears the failure notice", async () => {
    mockedInvoke.mockRejectedValueOnce("disk full");
    await autoSave();
    await autoSave();
    expect(useAutoSaveStore.getState().failed).toBe(false);
  });

  it("calls made while a save runs give exactly one more save afterwards", async () => {
    let finishFirst: () => void = () => undefined;
    mockedInvoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const first = autoSave();
    const second = autoSave();
    const third = autoSave();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    finishFirst();
    await Promise.all([first, second, third]);
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(useGameStore.getState().isDirty).toBe(false);
  });
});
