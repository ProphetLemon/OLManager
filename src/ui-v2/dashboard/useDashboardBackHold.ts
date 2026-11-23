import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";

import { paletteEntryPop } from "@/ui-v2/palette/paletteHistory";

/** How long the pop of our own `history.forward()` is waited for before it is forgotten. */
export const DASHBOARD_RESTORE_TIMEOUT_MS = 400;

/**
 * What the system Back does on the dashboard when nothing over it claims the pop.
 *
 * The intent is that Back keeps the player in the game, on the same tab. Leaving a game
 * happens only through More, then Exit to Menu.
 *
 * Android, one WebView whose Back walks its history: the pop has already moved the history
 * by the time `popstate` fires, and React Router's bubble-phase listener renders the route
 * it landed on in a microtask that runs between two listeners of the same event, which
 * unmounts the dashboard and removes its own bubble-phase listener before it runs. So this
 * listener runs in the capture phase, stops the event (the router never learns of the pop,
 * and keeps showing the dashboard) and takes the entry back with `history.forward()`. That
 * puts the history exactly where it was, so any number of Backs leave its length alone and
 * never drain it to the point where the WebView has nowhere to go back to and Android
 * closes the app. The pop that `forward()` raises is ours and is stopped too.
 *
 * A pop that only took the Go palette's or the More menu's own entry off (or a close's
 * `history.back()`) is not for the dashboard: `paletteEntryPop` asks about the same event
 * whatever the order of the listeners, and that pop goes on to the router untouched.
 *
 * Elsewhere nothing changes: the handler stays what it was, a bubble-phase listener that
 * replaces the location with /dashboard and adds no history call of its own.
 */
export function useDashboardBackHold(android: boolean, navigate: NavigateFunction): void {
  useEffect(() => {
    if (!android) {
      const handlePopState = (event: PopStateEvent) => {
        if (paletteEntryPop(event)) return;
        navigate("/dashboard", { replace: true });
      };
      window.addEventListener("popstate", handlePopState);
      return () => window.removeEventListener("popstate", handlePopState);
    }

    let restoring = false;
    let timer: number | undefined;
    const settle = () => {
      restoring = false;
      window.clearTimeout(timer);
    };
    const handlePopState = (event: PopStateEvent) => {
      if (restoring) {
        // The pop of our own forward(): the history is back on the dashboard's entry.
        settle();
        event.stopPropagation();
        return;
      }
      if (paletteEntryPop(event)) return;
      event.stopPropagation();
      restoring = true;
      // If the pop never comes (forward() found nothing to go to), a later Back is still held.
      timer = window.setTimeout(settle, DASHBOARD_RESTORE_TIMEOUT_MS);
      window.history.forward();
    };
    window.addEventListener("popstate", handlePopState, true);
    return () => {
      settle();
      window.removeEventListener("popstate", handlePopState, true);
    };
  }, [android, navigate]);
}
