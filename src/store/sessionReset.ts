import { useCallCacheStore } from "./callCacheStore";
import { useDashboardLocationStore } from "./dashboardLocationStore";
import { useNavMemoryStore } from "./navMemoryStore";
import { useTabUiStore } from "./tabUiStore";

/**
 * Forgets one save's navigation (R22): the rail memory, the tab UI state, the
 * location and its back stack, and the cached blockers. Runs on a new game, a
 * load and an exit, so nothing carries over into another save.
 */
export function resetSessionNavigation(): void {
  useNavMemoryStore.getState().resetNavMemory();
  useTabUiStore.getState().resetTabUi();
  useDashboardLocationStore.getState().reset();
  useCallCacheStore.getState().reset();
}
