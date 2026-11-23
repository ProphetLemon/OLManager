import { useEffect, useLayoutEffect } from "react";
import type { NavigateFunction } from "react-router-dom";

import { BACK_RESTORE_TIMEOUT_MS, setBackMeaning } from "@/lib/backGuard";
import { paletteEntryPop } from "@/ui-v2/palette/paletteHistory";

/** How long the pop of our own `history.forward()` is waited for before it is forgotten. */
export const DASHBOARD_RESTORE_TIMEOUT_MS = BACK_RESTORE_TIMEOUT_MS;

/**
 * What the system Back does on the dashboard when nothing over it claims the pop.
 *
 * The intent is that Back keeps the player in the game, on the same tab. Leaving a game
 * happens only through More, then Exit to Menu.
 *
 * Android, one WebView whose Back walks its history: the pop has already moved the history
 * by the time `popstate` fires, and React Router renders the route it landed on in a
 * microtask that unmounts the dashboard before a listener registered after the router's can
 * run. So the dashboard registers no listener: it sets "hold" in the Back guard
 * (`lib/backGuard.ts`) while it is mounted. The native `back-button` handler then makes
 * no history call for a press on the dashboard; if it is not registered, the guard's
 * `popstate` listener, installed before the router's, stops the event and takes the entry
 * back with `history.forward()`. That puts
 * the history exactly where it was, so any number of Backs leave its length alone and never
 * drain it to the point where the WebView has nowhere to go back to and Android closes the
 * app. The pop that `forward()` raises is swallowed by the guard too.
 *
 * A pop that only took the Go palette's or the More menu's own entry off (or a close's
 * `history.back()`) is not for the dashboard: the guard leaves it to the palette and the
 * router untouched.
 *
 * Elsewhere nothing changes: the handler stays what it was, a bubble-phase listener that
 * replaces the location with /dashboard and adds no history call of its own.
 */
export function useDashboardBackHold(android: boolean, navigate: NavigateFunction): void {
  // A layout effect: the slot is right in the commit that shows the dashboard, before the next press.
  useLayoutEffect(() => {
    if (android) return setBackMeaning({ kind: "hold" });
  }, [android]);

  useEffect(() => {
    if (android) return;
    const handlePopState = (event: PopStateEvent) => {
      if (paletteEntryPop(event)) return;
      navigate("/dashboard", { replace: true });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [android, navigate]);
}
