import { useEffect } from "react";

/**
 * Closes the app when the system Back is pressed while the main menu is showing.
 *
 * The menu is the bottom of the app: whatever stale entries of a game that was
 * left lie behind it in the WebView's history, Back must not walk into them.
 * `popstate` fires after the history pop, so the listener only sees a Back that
 * happened while this menu was mounted. A menu that was just reached by Back
 * (from Settings, say) is not mounted yet when that event is dispatched, and
 * listeners added during a dispatch are not run for it, so an arrival never
 * closes the app. Pass `enabled` false off Android, where nothing changes.
 */
export function useMenuBackExit(enabled: boolean, exit: () => Promise<void>): void {
  useEffect(() => {
    if (!enabled) return;
    const handlePopState = () => {
      exit().catch((error) => console.error("Failed to exit app:", error));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [enabled, exit]);
}
