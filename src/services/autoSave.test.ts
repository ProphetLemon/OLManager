import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { autoSave, saveNow, setLiveMatchActive, useAutoSaveStore } from "./autoSave";
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
    useAutoSaveStore.setState({ failed: false, failCount: 0, savedCount: 0 });
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

  describe("a change or a different game while the save runs", () => {
    function pendingSave(): () => void {
      let finish: () => void = () => undefined;
      mockedInvoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
      return () => finish();
    }
    const other = { clock: { current_date: "2026-08-01" } } as unknown as GameStateData;

    it("keeps the game marked unsaved when its state changed during the save", async () => {
      const finish = pendingSave();
      const run = autoSave();
      useGameStore.getState().setGameState(other);
      finish();
      await run;
      expect(useGameStore.getState().isDirty).toBe(true);
    });

    it("the manual save follows the same rule", async () => {
      const finish = pendingSave();
      const run = saveNow();
      useGameStore.getState().setGameState(other);
      finish();
      await run;
      expect(useGameStore.getState().isDirty).toBe(true);
    });

    it("ignores the result of a save when another game was loaded meanwhile", async () => {
      const finish = pendingSave();
      const run = autoSave();
      useGameStore.getState().setGameActive(true, "Other");
      useGameStore.getState().setGameState(other);
      useGameStore.setState({ isDirty: true });
      finish();
      await run;
      expect(useGameStore.getState().isDirty).toBe(true);
      expect(useAutoSaveStore.getState().savedCount).toBe(0);
    });

    it("ignores the failure of a save when the game was unloaded meanwhile", async () => {
      let fail: (e: unknown) => void = () => undefined;
      mockedInvoke.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
      const run = autoSave();
      useGameStore.getState().clearGame();
      fail("disk full");
      await run;
      expect(useAutoSaveStore.getState().failed).toBe(false);
    });
  });

  it("leaving a game clears the failure notice", async () => {
    mockedInvoke.mockRejectedValueOnce("disk full");
    await autoSave();
    expect(useAutoSaveStore.getState().failed).toBe(true);
    useGameStore.getState().clearGame();
    expect(useAutoSaveStore.getState().failed).toBe(false);
  });

  it("every failure is counted, so it can be announced again", async () => {
    mockedInvoke.mockRejectedValue("disk full");
    await autoSave();
    await autoSave();
    expect(useAutoSaveStore.getState().failCount).toBe(2);
  });

  describe("the manual save", () => {
    it("saves, marks clean, clears a failure and counts as saved", async () => {
      useAutoSaveStore.setState({ failed: true });
      await saveNow();
      expect(mockedInvoke).toHaveBeenCalledWith("save_game");
      expect(useGameStore.getState().isDirty).toBe(false);
      expect(useAutoSaveStore.getState().failed).toBe(false);
      expect(useAutoSaveStore.getState().savedCount).toBe(1);
    });

    it("saves even when the setting is off, and a failure shows the notice instead of throwing", async () => {
      setAutoSave(false);
      mockedInvoke.mockRejectedValue("disk full");
      await expect(saveNow()).resolves.toBeUndefined();
      expect(useAutoSaveStore.getState().failed).toBe(true);
      expect(useGameStore.getState().isDirty).toBe(true);
    });
  });
});
