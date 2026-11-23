import { paletteEntryPhase, paletteHoldsEntry } from "@/ui-v2/palette/paletteHistory";

/**
 * What the system Back means while a screen is showing, on Android.
 *
 * Primary path, the native `back-button` event. Tauri's Android plugin traverses the history
 * (or finishes the activity when it cannot) only when no JS listener is registered for it; a
 * listener makes it just emit `{ canGoBack }`. `registerNativeBack` registers one at startup
 * and `handleNativeBack` decides from the slot, never from the payload (`canGoBack` can be
 * stale by the time the handler runs). A press on a hold therefore makes no history call, so
 * the WebView never sits on index 0 between a traversal and a `history.forward()` that a busy
 * main thread delays, where a second press would find `canGoBack()` false and close the app.
 *
 * One traversal at a time. The handler's own `history.back()` (palette entry pushed, or nothing
 * set with `canGoBack` true) marks a back as in flight, and every press is ignored until its
 * pop arrives (the guard clears the mark first thing, being the first listener) or 400 ms pass
 * with no pop. A press also waits while the guard's own `forward()` restore is pending. What
 * that means for each path:
 * - the palette's pushed entry: the first press takes it off, a second before the pop is
 *   ignored (it used to walk past the dashboard's own entry); its release is `releasing`,
 *   whose pop is already coming, and is ignored as well;
 * - Settings, a match screen or any screen with nothing set: one press walks one step, and
 *   repeated presses before the pop do nothing, so a press that carries `canGoBack: false`
 *   because a traversal is pending cannot close the app; after the pop the next press
 *   decides afresh from the slot, and a press that finds nothing behind it closes the app;
 * - a hold or an exit makes no traversal, so nothing is in flight and each press is decided
 *   on its own (exit is retried by the next press if it was rejected);
 * - a pop that never arrives clears the mark after the timeout, so a press is never lost for
 *   good.
 * Screens set the meaning in a layout effect, so when a pop makes the router render the
 * dashboard or the menu the slot is already right when the next press is handled.
 *
 * Fallback, the `popstate` guard below, for when the registration failed or has not resolved
 * yet (the native default is then in force) and for pops nobody pressed Back for (the
 * `history.back()` of the palette's release or of a "go back" press). The rest of this
 * comment is about it.
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
 *
 * Interplay: the pop a native "go back" press raises (nothing set) is read by the guard
 * against the slot at the time it lands. Still nothing set: it goes to the router. A menu
 * has mounted since (two quick presses on Settings): the guard exits, which is what the
 * second press means. The dashboard has: the guard holds it, so the player stays on the
 * dashboard. Either way the app is left on a screen that is showing and not stuck.
 */
export type BackMeaning = { kind: "hold" } | { kind: "exit"; exit: () => Promise<void> };

/** How long the pop of our own `history.forward()` is waited for before it is forgotten. */
export const BACK_RESTORE_TIMEOUT_MS = 400;

let installed = false;
let meaning: BackMeaning | null = null;
let restoring = false;
let restoreTimer: number | undefined;
/** A `history.back()` of ours whose pop has not arrived yet. */
let backInFlight = false;
let backTimer: number | undefined;
function settleBack(): void {
  backInFlight = false;
  window.clearTimeout(backTimer);
}

function goBackOnce(): void {
  backInFlight = true;
  window.clearTimeout(backTimer);
  backTimer = window.setTimeout(settleBack, BACK_RESTORE_TIMEOUT_MS);
  window.history.back();
}

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
  settleBack(); // first: whatever this pop is, the traversal in flight has landed
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
  settleBack();
}

/** The payload of Tauri's Android `back-button` event. */
export type NativeBackPayload = { canGoBack: boolean };

function logExitFailure(error: unknown): void {
  console.error("Failed to exit app:", error);
}

function callExit(exit: () => Promise<void>): void {
  try {
    exit().catch(logExitFailure);
  } catch (error) {
    logExitFailure(error);
  }
}

/**
 * What a native Back press does, once a JS listener owns the event. The slot decides first;
 * `canGoBack` is read only when nothing is set (Settings, team selection, the match screens),
 * where Back goes back, or closes the app when there is nowhere to go. The palette's entry
 * is checked before the slot, as in the popstate guard: pushed, a press takes it off with
 * `history.back()` (its own listener then closes it); releasing, its pop is already coming,
 * so the press is ignored. While a traversal of ours is in flight, or the guard's restore is
 * pending, every press is ignored (see the header).
 */
export function handleNativeBack(payload: NativeBackPayload, exitApp: () => Promise<void>): void {
  if (backInFlight || restoring) return;
  const phase = paletteEntryPhase();
  if (phase === "releasing") return;
  if (phase === "pushed") {
    goBackOnce();
    return;
  }
  if (meaning?.kind === "hold") return;
  if (meaning?.kind === "exit") {
    callExit(meaning.exit);
    return;
  }
  if (payload.canGoBack) goBackOnce();
  else callExit(exitApp);
}

/**
 * Registers the native `back-button` listener (`onBackButtonPress` from `@tauri-apps/api/app`,
 * passed in so this stays testable). A rejected registration is reported with `console.error`
 * (the app has no other front-end error report) and never thrown: the native default stays in
 * force and the popstate guard keeps working as the fallback.
 */
export async function registerNativeBack(
  register: (handler: (payload: NativeBackPayload) => void) => Promise<unknown>,
  exitApp: () => Promise<void>,
): Promise<void> {
  try {
    await register((payload) => handleNativeBack(payload, exitApp));
  } catch (error) {
    console.error("Failed to register the native back-button listener:", error);
  }
}
