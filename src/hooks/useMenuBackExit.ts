import { useEffect } from "react";

import { setBackMeaning } from "@/lib/backGuard";

/**
 * Makes the system Back close the app while the main menu is showing.
 *
 * The menu is the bottom of the app: whatever stale entries of a game that was left lie
 * behind it in the WebView's history, Back must not walk into them. The menu only says what
 * Back means while it is mounted. The native `back-button` handler in `lib/backGuard.ts`
 * calls `exit` directly and touches no history; the `popstate` listener there, which runs
 * before the router's and is the fallback, stops the event (so the router never renders the
 * stale route while the app is closing), takes the entry back and calls `exit`. A menu that was just
 * reached by Back (from Settings, say) was not mounted when that event was dispatched, so
 * an arrival never closes the app. Pass `enabled` false off Android, where nothing changes.
 */
export function useMenuBackExit(enabled: boolean, exit: () => Promise<void>): void {
  useEffect(() => {
    if (!enabled) return;
    return setBackMeaning({ kind: "exit", exit });
  }, [enabled, exit]);
}
