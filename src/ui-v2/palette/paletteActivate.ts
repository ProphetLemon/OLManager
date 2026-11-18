import { callAction, opensOwnFocus } from "@/lib/dashboard/callAction";
import type { DashboardLocation, NavIntent } from "@/lib/dashboard/profileNavigation";

import type { TabUiStates } from "@/store/tabUiStore";

import type { PaletteEntry, PaletteViewTarget } from "./paletteIndex";

/** tabUiStore's `setTabFields`. */
export type SetTabFields = <T extends keyof TabUiStates>(tab: T, patch: Partial<TabUiStates[T]>) => void;

/** Where the Settings row goes; NR2.8 adds `state.from`, the only thing Settings reads. */
export const SETTINGS_PATH = "/settings";

/**
 * What activating a palette row does: a dashboard move (`NavIntent`), a tab with
 * the sub-view to write in tabUiStore first, or the route to Settings, which
 * leaves the dashboard.
 */
export type PaletteIntent =
  | NavIntent
  | { kind: "tab"; tab: string; view: PaletteViewTarget }
  | { kind: "route"; path: typeof SETTINGS_PATH };

/** The move back to a recent place: its profile or champion page, else its tab. */
function locationIntent(location: DashboardLocation): NavIntent {
  if (location.championKey !== null) return { kind: "champion", key: location.championKey };
  if (location.playerId !== null) return { kind: "player", id: location.playerId };
  if (location.teamId !== null) return { kind: "team", id: location.teamId };
  if (location.staffId !== null) return { kind: "staff", id: location.staffId };
  return { kind: "tab", tab: location.tab };
}

export function entryToIntent(entry: PaletteEntry): PaletteIntent {
  switch (entry.kind) {
    case "call":
      return callAction(entry.item);
    case "recent":
      return locationIntent(entry.location);
    case "section":
      return { kind: "tab", tab: entry.tab };
    case "settings":
      return { kind: "route", path: SETTINGS_PATH };
    case "view":
      return { kind: "tab", tab: entry.tab, view: entry.view };
  }
}

/**
 * Whether the intent's own UI takes focus and is spoken: the Settings page, and
 * whatever `opensOwnFocus` names (no move, while the renewal dialog is the legacy
 * frame, R69). The palette then skips its focus on main and its announcement for
 * that row (R37).
 */
export function paletteOpensOwnFocus(intent: PaletteIntent): boolean {
  if (intent.kind === "route") return true;
  if (intent.kind === "tab" && "view" in intent) return false;
  return opensOwnFocus(intent);
}

/**
 * Writes the sub-view a Views row opens, before the move to its tab. A Competitions
 * view also selects its league, in the same update (R67), so the tab never renders
 * the view with the old league.
 */
export function writePaletteView(view: PaletteViewTarget, setTabFields: SetTabFields): void {
  switch (view.slice) {
    case "competitions":
      setTabFields(
        "competitions",
        view.selectedCid === undefined ? { view: view.value } : { view: view.value, selectedCid: view.selectedCid },
      );
      return;
    case "schedule":
      setTabFields("schedule", { view: view.value });
      return;
    case "training":
      setTabFields("training", { view: view.value });
      return;
    case "staff":
    case "worldStaff":
      setTabFields(view.slice, { view: view.value });
      return;
    case "finances":
      setTabFields("finances", { view: view.value });
      return;
    case "transfers":
      setTabFields("transfers", { view: view.value });
      return;
  }
}
