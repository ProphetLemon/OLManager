import { useEffect } from "react";

/**
 * Closes the app when the system Back is pressed while the main menu is showing.
 *
 * The menu is the bottom of the app: whatever stale entries of a game that was
 * left lie behind it in the WebView's history, Back must not walk into them.
 *
 * The listener runs in the capture phase, before React Router's. A Back that lands
 * on another route (Settings, the dead "No active game" screen) is rendered by the
 * router's bubble-phase listener in a microtask that runs between the two listeners
 * of the same event, which unmounts the menu and removes a bubble-phase listener
 * before it runs. Capturing runs first whatever route the pop lands on. The event is
 * then stopped, so the router never renders the stale route while the app is closing;
 * if `exit` fails the menu simply stays on screen and the next Back tries again.
 *
 * A menu that was just reached by Back (from Settings, say) is not mounted yet when
 * that event is dispatched, and listeners added during a dispatch are not run for it,
 * so an arrival never closes the app. Pass `enabled` false off Android, where nothing
 * changes.
 */
export function useMenuBackExit(enabled: boolean, exit: () => Promise<void>): void {
  useEffect(() => {
    if (!enabled) return;
    const handlePopState = (event: Event) => {
      event.stopPropagation();
      exit().catch((error) => console.error("Failed to exit app:", error));
    };
    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, [enabled, exit]);
}
