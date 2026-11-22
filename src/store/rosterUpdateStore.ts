import { create } from "zustand";

import {
  getWorldOverlayInfo,
  updateWorldOverlay,
  type WorldOverlayInfo,
} from "@/services/worldOverlayService";

/**
 * Where the roster check stands. `updated` and `upToDate` are the outcomes of
 * the last finished check; `failed` keeps the overlay already known.
 */
export type RosterUpdateStatus = "idle" | "checking" | "updated" | "upToDate" | "failed";

/** A successful check older than this is repeated when the new-game screen opens. */
export const ROSTER_RECHECK_AFTER_MS = 60 * 60 * 1000;

/**
 * How long a check may wait for the backend's answer before it counts as
 * failed. Longer than the backend's own timeouts (5 s automatic, 15 s manual),
 * so it only fires when the IPC call itself hangs; the new-game screen holds
 * its Confirm button back while a check runs, so it must always settle.
 */
export const ROSTER_CHECK_TIMEOUT_MS = 20_000;

interface RosterUpdateState {
  status: RosterUpdateStatus;
  /** The overlay a new game would use: its `as_of` date and its licence. */
  info: WorldOverlayInfo | null;
  /** When the last check finished (ms since the epoch), whatever its outcome. */
  lastCheckedAt: number | null;
}

const INITIAL_STATE: RosterUpdateState = { status: "idle", info: null, lastCheckedAt: null };

/**
 * The roster overlay used by NEW games and its update checks. Saves never read
 * it. One check runs at app launch; the new-game screen repeats it only when
 * it failed or is old, and a failure offers a manual retry.
 */
export const useRosterUpdateStore = create<RosterUpdateState>(() => ({ ...INITIAL_STATE }));

let inFlight: Promise<void> | null = null;
let launchCheckStarted = false;

/** `answer`, or a rejection once `ms` have passed without one. */
function withTimeout<T>(answer: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer after ${ms} ms`)), ms);
  });
  return Promise.race([answer, expiry]).finally(() => clearTimeout(timer));
}

async function runCheck(manual: boolean): Promise<void> {
  useRosterUpdateStore.setState({ status: "checking" });
  try {
    // The automatic path has a short backend timeout; a manual retry gets the long one.
    const request = manual ? updateWorldOverlay() : updateWorldOverlay({ automatic: true });
    // An answer that comes after the timeout is dropped: the check already failed.
    const info = await withTimeout(request, ROSTER_CHECK_TIMEOUT_MS);
    if (!info) throw new Error("no roster overlay info returned");
    useRosterUpdateStore.setState({
      status: info.updated ? "updated" : "upToDate",
      info,
      lastCheckedAt: Date.now(),
    });
  } catch (err) {
    console.warn("[RosterUpdates] roster update check failed:", err);
    useRosterUpdateStore.setState({ status: "failed", lastCheckedAt: Date.now() });
  }
}

/**
 * Check for newer rosters. Never two at once: a call made while a check runs
 * gets that check's promise. Resolves when the check is over, never rejects.
 */
export function checkForRosterUpdates({ manual = false }: { manual?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight;
  const run = runCheck(manual).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/** The Retry action after a failed check: the manual path, with the long timeout. */
export function retryRosterCheck(): Promise<void> {
  return checkForRosterUpdates({ manual: true });
}

/** Read the overlay a new game would use, unless a finished check already set it. */
function loadRosterInfo(): void {
  getWorldOverlayInfo()
    .then((info) => {
      if (info && useRosterUpdateStore.getState().info === null) {
        useRosterUpdateStore.setState({ info });
      }
    })
    .catch((err) => console.warn("[RosterUpdates] could not read the roster overlay info:", err));
}

/** The background check made once per app session, at launch. It never blocks the caller. */
export function startRosterLaunchCheck(): void {
  if (launchCheckStarted) return;
  launchCheckStarted = true;
  loadRosterInfo();
  void checkForRosterUpdates();
}

/**
 * The new-game screen's re-check: only when the last check failed, never ran
 * or is more than an hour old, and never while one is running.
 */
export function recheckRostersIfStale(now: number = Date.now()): void {
  const { status, info, lastCheckedAt } = useRosterUpdateStore.getState();
  if (info === null) loadRosterInfo();
  if (status === "checking") return;
  const stale =
    status === "failed" || lastCheckedAt === null || now - lastCheckedAt > ROSTER_RECHECK_AFTER_MS;
  if (stale) void checkForRosterUpdates();
}

/** Test helper: back to a fresh session (no launch check, no check running). */
export function resetRosterUpdatesForTests(): void {
  inFlight = null;
  launchCheckStarted = false;
  useRosterUpdateStore.setState({ ...INITIAL_STATE });
}
