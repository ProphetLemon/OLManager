import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";

/** What the dashboard shows of the last auto-saves: `savedCount` flashes "Saved", `failed` raises the notice. */
export const useAutoSaveStore = create<{ failed: boolean; failCount: number; savedCount: number }>(() => ({
  failed: false,
  failCount: 0,
  savedCount: 0,
}));

// A failure belongs to the game it happened in.
useGameStore.subscribe((state, prev) => {
  if (state.session !== prev.session) useAutoSaveStore.setState({ failed: false });
});

// The backend keeps a live match session from the advance that starts it until it is finished;
// the live match screen says so for as long as it is mounted and not yet finalised.
let liveMatchActive = false;
export function setLiveMatchActive(active: boolean): void {
  liveMatchActive = active;
}

let running = false;
let again = false;

function canSave(): boolean {
  const { gameState, isDirty } = useGameStore.getState();
  return useSettingsStore.getState().settings.auto_save && !!gameState && isDirty && !liveMatchActive;
}

/**
 * One write of the active game. The result counts only for the game that was saved: it is dropped
 * when another game was loaded or the game left meanwhile, and the game is marked clean only if its
 * state is still the one that went out. `newerQueued` says another save was asked for meanwhile.
 */
async function write(newerQueued: () => boolean): Promise<void> {
  const before = useGameStore.getState();
  try {
    await invoke("save_game");
  } catch (error) {
    console.error("Save failed:", error);
    if (useGameStore.getState().session === before.session) {
      useAutoSaveStore.setState((s) => ({ failed: true, failCount: s.failCount + 1 }));
    }
    return;
  }
  const now = useGameStore.getState();
  if (now.session !== before.session) return;
  if (!newerQueued() && now.gameState === before.gameState) now.markClean();
  useAutoSaveStore.setState((s) => ({ failed: false, savedCount: s.savedCount + 1 }));
}

/** The Save button: writes now, whatever the setting says. Never throws; a failure raises the notice. */
export function saveNow(): Promise<void> {
  return write(() => false);
}

/**
 * Writes the game when the Auto-Save setting is on and something is unsaved. Never overlaps itself:
 * a call during a save asks for one more save once it ends. Never throws: a failure keeps the game
 * marked unsaved and raises `useAutoSaveStore().failed`. Callers do not await it on the Continue path.
 */
export async function autoSave(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      if (!canSave()) continue;
      await write(() => again);
    } while (again);
  } finally {
    running = false;
  }
}
