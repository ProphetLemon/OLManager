import { paletteHoldsEntry } from "@/ui-v2/palette/paletteHistory";

/**
 * What the system Back means while a screen is showing, on Android.
 *
 * The WebView's Back walks its browser history and raises `popstate` on `window`. Chromium
 * runs the listeners of that event in registration order, whatever their capture flag, and
 * react-dom renders a popstate-caused route change in a microtask that runs before the next
 * listener, unmounting the screen and removing its listeners. React Router registers its
 * listener when the app first mounts, so a listener a screen registers can never act on a
 * Back that changes the route (`stopPropagation()` would not stop it either: only
 * `stopImmediatePropagation()` keeps the listeners registered after the caller from running).
 *
 * So there is one listener, installed before the app renders (`main.tsx`), and screens only
 * say what Back means while they are mounted. When the pop arrives the slot still describes
 * the screen that was showing when Back was pressed, which is what is wanted: a menu reached
 * by Back (from Settings, say) was not mounted during that event, so it never closes the app.
 *
 * - `hold`: the entry is taken back with `history.forward()`, so the history position and
 *   length are unchanged and no number of Backs can drain it.
 * - `exit`: the entry is taken back the same way and `exit` is called. The restore leaves the
 *   URL and the router in agreement, so a rejected exit (logged, never thrown) is retried by
 *   the next Back. On success the app closes and the restore is moot.
 * - nothing set: the event is not touched.
 *
 * The pop that `forward()` raises is ours and is swallowed whichever screen is mounted when
 * it lands, so the pending restore lives here and not in a component.
 */
export type BackMeaning = { kind: "hold" } | { kind: "exit"; exit: () => Promise<void> };

/** How long the pop of our own `history.forward()` is waited for before it is forgotten. */
export const BACK_RESTORE_TIMEOUT_MS = 400;

let installed = false;
let meaning: BackMeaning | null = null;
let restoring = false;
let restoreTimer: number | undefined;

function settleRestore(): void {
  restoring = false;
  window.clearTimeout(restoreTimer);
}

function restoreEntry(): void {
  restoring = true;
  window.clearTimeout(restoreTimer);
  // If the pop never comes (forward() found nothing to go to), a later Back is still taken.
  restoreTimer = window.setTimeout(settleRestore, BACK_RESTORE_TIMEOUT_MS);
  window.history.forward();
}

function onPopState(event: Event): void {
  if (restoring) {
    // The pop of our own forward(): the history is back on the entry Back was pressed on.
    settleRestore();
    event.stopImmediatePropagation();
    return;
  }
  const current = meaning;
  if (!current) return;
  // A pop that took the Go palette's or the More menu's own entry off (or the history.back()
  // that releases it) is theirs and the router's, not the screen's.
  if (paletteHoldsEntry()) return;
  event.stopImmediatePropagation();
  restoreEntry();
  if (current.kind === "exit") {
    try {
      current.exit().catch((error) => console.error("Failed to exit app:", error));
    } catch (error) {
      console.error("Failed to exit app:", error);
    }
  }
}

/**
 * Registers the one listener, first in registration order (call it before the router
 * renders), in the capture phase and never removed. Idempotent. An empty slot makes it
 * inert, so it is installed on every platform and screens fill the slot only on Android.
 */
export function installBackGuard(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("popstate", onPopState, { capture: true });
}

/**
 * Sets what Back means for the screen that is mounted. The returned function clears it,
 * unless another screen has set its own meaning since.
 */
export function setBackMeaning(next: BackMeaning): () => void {
  meaning = next;
  return () => {
    if (meaning === next) meaning = null;
  };
}

/** Test-only: forgets the meaning and any pending restore. */
export function resetBackGuardForTests(): void {
  meaning = null;
  settleRestore();
}
