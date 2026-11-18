/**
 * The Go palette's own history entry, on Android only (R87, R79).
 *
 * wry 0.55.1 turns the back gesture into the webview's `goBack()` only when `canGoBack()`;
 * otherwise Back leaves the app with the palette open. So the palette pushes an entry when
 * it opens, and the gesture pops it. A close by any other path (Escape, Close, an
 * activation) takes the entry off with `history.back()`, which pops it in a later task.
 *
 * Both popstate handlers ask `paletteEntryPop` about the same event: the palette's, which
 * closes on Back, and DashboardV2's, which runs no `navigate` for this pop. The verdict is
 * kept per event, so it does not depend on which listener runs first.
 */

/** `back` when the back gesture popped the entry, `release` when a close's `history.back()` did. */
export type PaletteEntryPop = "back" | "release";

type EntryState = "none" | "pushed" | "releasing";

let entry: EntryState = "none";
/** The palette reopened while its old entry was coming off: push again once it is off. */
let repush = false;
let listening = false;
const verdicts = new WeakMap<Event, PaletteEntryPop | null>();
const waiters = new Set<() => void>();

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
    if (repush) {
      repush = false;
      push();
    } else {
      for (const run of [...waiters]) run();
      waiters.clear();
    }
  }
  verdicts.set(event, verdict);
  return verdict;
}

/** Pushes the palette's entry, once; a reopening before the old entry is off pushes after it. */
export function pushPaletteEntry(): void {
  if (!listening) {
    // Every pop is classified, even with neither the palette nor the dashboard mounted.
    window.addEventListener("popstate", classify, true);
    listening = true;
  }
  if (entry === "none") push();
  else if (entry === "releasing") repush = true;
}

/** On a close that was not a pop: takes the palette's entry off with `history.back()`. */
export function releasePaletteEntry(): void {
  repush = false;
  if (entry !== "pushed") return;
  entry = "releasing";
  window.history.back();
}

/** Whether this pop took the palette's entry off, and how; `null` for any other pop. */
export function paletteEntryPop(event: PopStateEvent): PaletteEntryPop | null {
  return classify(event);
}

/**
 * Runs `run` once the palette's entry is off the history: now if it is, else after its pop.
 * Returns a cancel function. A route the run pushes then cannot be undone by that pop.
 */
export function whenPaletteEntryOff(run: () => void): () => void {
  if (entry === "none") {
    run();
    return () => {};
  }
  waiters.add(run);
  return () => {
    waiters.delete(run);
  };
}

/** Forgets the entry without traversing, for a palette that unmounts while it is open. */
export function forgetPaletteEntry(): void {
  repush = false;
  waiters.clear();
  // An entry already coming off keeps its state, so its pop is still read as a release.
  if (entry === "pushed") entry = "none";
}
