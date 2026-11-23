/**
 * The Go palette's own history entry, on Android only (R87, R79).
 *
 * wry 0.55.1 turns the back gesture into the webview's `goBack()` only when `canGoBack()`;
 * otherwise Back leaves the app with the palette open. So the palette pushes an entry when
 * it opens, and the gesture pops it. A close by any other path (Escape, Close, an
 * activation) takes the entry off with `history.back()`, which pops it in a later task.
 *
 * That holds only without the native `back-button` listener (`lib/backGuard.ts`). While it is
 * registered (`setNativeBackRegistered`, set when its registration resolves) an opening
 * pushes no entry at all, a close releases none, and the Back press reaches the overlay
 * through a dismisser it registers while open (`registerBackDismisser`): a history traversal
 * left on the dashboard can be voided by a later `pushState`, so nothing there touches the
 * history for Back. An opening that did push an entry (the listener was not registered yet)
 * keeps the entry path until it closes.
 *
 * The palette's and More's popstate handlers ask `paletteEntryPop` about the same event, and
 * the verdict is kept per event, so it does not depend on which listener runs first. The
 * Back guard (`lib/backGuard.ts`) runs before all of them and must not run those side
 * effects ahead of the router, so it asks `paletteHoldsEntry`, which has none.
 */

/** `back` when the back gesture popped the entry, `release` when a close's `history.back()` did. */
export type PaletteEntryPop = "back" | "release";

type EntryState = "none" | "pushed" | "releasing";

let entry: EntryState = "none";
/** The palette reopened while its old entry was coming off: push again once it is off. */
let repush = false;
let listening = false;
const verdicts = new WeakMap<Event, PaletteEntryPop | null>();
/** Each waiting run, with its fallback timer. */
const waiters = new Map<() => void, number>();
/** The fallback armed while the entry is coming off; see `startRelease`. */
let releaseTimer: number | undefined;

/**
 * How long an activated row waits for the entry's pop before it runs anyway (R89): a pop
 * the WebView drops, or a history someone else traversed, must not swallow the activation.
 */
export const PALETTE_ENTRY_POP_TIMEOUT_MS = 400;

function runWaiters(): void {
  const runs = [...waiters];
  waiters.clear();
  for (const [run, timer] of runs) {
    window.clearTimeout(timer);
    run();
  }
}

function dropWaiters(): void {
  for (const timer of waiters.values()) window.clearTimeout(timer);
  waiters.clear();
}

function clearReleaseTimer(): void {
  if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
  releaseTimer = undefined;
}

/**
 * The fallback for an entry that is coming off: if its pop never arrives, forget the entry
 * (and push the one a reopening asked for), so `entry` cannot stay `"releasing"` for good.
 */
function settleRelease(): void {
  clearReleaseTimer();
  if (entry === "releasing") {
    entry = "none";
    if (repush) {
      repush = false;
      push();
    }
  }
  runWaiters();
}

/** Takes the entry off with `history.back()` and arms the fallback; a new call restarts it. */
function startRelease(): void {
  entry = "releasing";
  clearReleaseTimer();
  releaseTimer = window.setTimeout(settleRelease, PALETTE_ENTRY_POP_TIMEOUT_MS);
  window.history.back();
}

function push(): void {
  // The router's state (`idx`, `key`) stays, so React Router reads this entry as its own.
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.pushState({ ...state, olmPalette: true }, "");
  entry = "pushed";
}

function classify(event: Event): PaletteEntryPop | null {
  if (verdicts.has(event)) return verdicts.get(event) ?? null;
  let verdict: PaletteEntryPop | null = null;
  if (entry !== "none") {
    verdict = entry === "pushed" ? "back" : "release";
    entry = "none";
    clearReleaseTimer();
    if (repush) {
      repush = false;
      push();
    } else {
      runWaiters();
    }
  }
  // A pop that comes after the fallback has fired finds `entry === "none"` and is `null`,
  // so the Back guard treats it as an ordinary Back: on the dashboard it is undone with
  // history.forward(), elsewhere it is replaced by /dashboard. That is accepted, since the
  // fallback only fires when the WebView dropped the pop, and a late one is rare.
  verdicts.set(event, verdict);
  return verdict;
}

let nativeRegistered = false;
const dismissers: Array<() => void> = [];

/** Set by `registerNativeBack` once the native listener is registered. */
export function setNativeBackRegistered(registered: boolean): void {
  nativeRegistered = registered;
}

/** Whether the native `back-button` listener is registered. */
export function nativeBackRegistered(): boolean {
  return nativeRegistered;
}

/**
 * Registers what a native Back press does while an overlay is open: close it. Returns the
 * function that unregisters it. The most recently registered overlay is dismissed first.
 */
export function registerBackDismisser(dismiss: () => void): () => void {
  dismissers.push(dismiss);
  return () => {
    const at = dismissers.lastIndexOf(dismiss);
    if (at !== -1) dismissers.splice(at, 1);
  };
}

/** Closes the most recently opened overlay; `false` when none is open. */
export function dismissOverlayWithBack(): boolean {
  const top = dismissers[dismissers.length - 1];
  if (!top) return false;
  top();
  return true;
}

/** Test-only: forgets the native flag and every dismisser. */
export function resetNativeBackOverlaysForTests(): void {
  nativeRegistered = false;
  dismissers.length = 0;
}

/**
 * Pushes the palette's entry, once; a reopening before the old entry is off pushes after it.
 * Pushes nothing while the native listener is registered, unless an entry is still on or
 * coming off from an opening before that.
 */
export function pushPaletteEntry(): void {
  if (nativeRegistered && entry === "none") return;
  if (!listening) {
    // Every pop is classified, even with neither the palette nor the dashboard mounted.
    window.addEventListener("popstate", classify, true);
    listening = true;
  }
  if (entry === "none") push();
  else if (entry === "releasing") {
    repush = true;
    // The pop may still never come: give the reopening its own full wait.
    clearReleaseTimer();
    releaseTimer = window.setTimeout(settleRelease, PALETTE_ENTRY_POP_TIMEOUT_MS);
    // A reopening drops the row its close was waiting to run (R89).
    dropWaiters();
  }
}

/** On a close that was not a pop: takes the palette's entry off with `history.back()`. */
export function releasePaletteEntry(): void {
  repush = false;
  if (entry !== "pushed") return;
  startRelease();
}

/**
 * Whether the palette holds an entry that is on the history or coming off it, so the next
 * pop is for it. Changes nothing and runs no waiter. After the release fallback has fired
 * the entry is forgotten, so a pop that arrives then is an ordinary Back.
 */
export function paletteHoldsEntry(): boolean {
  return entry !== "none";
}

/**
 * The same peek, told apart: `pushed` while the entry sits on the history (a Back takes it
 * off), `releasing` while the palette's own `history.back()` is coming off (its pop is
 * already on the way), `none` otherwise. Changes nothing and runs no waiter.
 */
export function paletteEntryPhase(): EntryState {
  return entry;
}

/** Whether this pop took the palette's entry off, and how; `null` for any other pop. */
export function paletteEntryPop(event: PopStateEvent): PaletteEntryPop | null {
  return classify(event);
}

/**
 * Runs `run` once the palette's entry is off the history: now if it is, else after its pop,
 * or after `PALETTE_ENTRY_POP_TIMEOUT_MS` if the pop never comes, which also forgets the
 * entry. Returns a cancel function. A route the run pushes then cannot be undone by that pop.
 */
export function whenPaletteEntryOff(run: () => void): () => void {
  if (entry === "none") {
    run();
    return () => {};
  }
  // A wrapper per call, so the same function waiting twice is two waiters.
  const waiter = () => run();
  const timer = window.setTimeout(settleRelease, PALETTE_ENTRY_POP_TIMEOUT_MS);
  waiters.set(waiter, timer);
  return () => {
    window.clearTimeout(timer);
    waiters.delete(waiter);
  };
}

/**
 * For a palette that unmounts while it is open. An entry still on top comes off, so the
 * next Back is not spent on it; one a route pushed or replaced over is only forgotten,
 * since going back would undo that route. An entry already coming off keeps its state, so
 * its pop is still read as a release.
 */
export function forgetPaletteEntry(): void {
  repush = false;
  dropWaiters();
  if (entry !== "pushed") return;
  if ((window.history.state as { olmPalette?: unknown } | null)?.olmPalette) {
    startRelease();
  } else {
    entry = "none";
  }
}
