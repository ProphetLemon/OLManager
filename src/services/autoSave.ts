import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";

/** What the dashboard shows of the last auto-saves: `savedCount` flashes "Saved", `failed` raises the notice. */
export const useAutoSaveStore = create<{ failed: boolean; savedCount: number }>(() => ({
  failed: false,
  savedCount: 0,
}));

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
      try {
        await invoke("save_game");
        // A call that came in meanwhile means newer state: the next pass marks it clean.
        if (!again) useGameStore.getState().markClean();
        useAutoSaveStore.setState((s) => ({ failed: false, savedCount: s.savedCount + 1 }));
      } catch (error) {
        console.error("Auto-save failed:", error);
        useAutoSaveStore.setState({ failed: true });
      }
    } while (again);
  } finally {
    running = false;
  }
}
