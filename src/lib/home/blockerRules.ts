import type { BlockerData } from "@/services/advanceTimeService";
import type { BlockerModal } from "@/hooks/useAdvanceTime.helpers";

/** Ids of the scrim stops `advance_time_with_mode` raises (and the pre-check reports). */
export const SCRIM_SETUP_BLOCKER_ID = "scrim_setup_required";
export const SCRIM_DECISION_BLOCKER_ID = "scrim_decision_required";

/** Scrim stops the Assistant Coach clears on its own while advancing. */
export const SCRIM_BLOCKER_IDS: ReadonlySet<string> = new Set([
  SCRIM_SETUP_BLOCKER_ID,
  SCRIM_DECISION_BLOCKER_ID,
]);

/**
 * Blockers the backend enforces: `advance_time_with_mode` refuses to move on
 * while they hold, so "Continue anyway" can never get past them.
 */
const BACKEND_ENFORCED_BLOCKER_IDS: ReadonlySet<string> = new Set([
  ...SCRIM_BLOCKER_IDS,
  "advance_blocked",
  "assistant_advance_limit",
]);

export function isBackendEnforcedBlocker(blocker: { id: string }): boolean {
  return BACKEND_ENFORCED_BLOCKER_IDS.has(blocker.id);
}

/** "Continue anyway" is only honest when nothing in the list is enforced. */
export function canContinueAnyway(blockers: ReadonlyArray<{ id: string }>): boolean {
  return !blockers.some(isBackendEnforcedBlocker);
}

/**
 * The advance paths that can raise a blocker modal, and what the backend does
 * when the user insists:
 * - `continue` and `skipToNextDay` both run `advance_time_with_mode`, which only
 *   refuses for the enforced ids above and lets every other blocker through.
 * - `skipToMatchDay` runs `skip_to_match_day`, which answers "blocked" whenever
 *   `compute_blocking_actions` is non-empty, so no blocker can be skipped there.
 */
export type AdvancePath = "continue" | "skipToNextDay" | "skipToMatchDay";

const PATHS_THAT_ENFORCE_EVERY_BLOCKER: ReadonlySet<AdvancePath> = new Set(["skipToMatchDay"]);

/** Whether pressing "Continue anyway" on `path` would actually advance. */
export function canContinueAnywayOnPath(
  path: AdvancePath,
  blockers: ReadonlyArray<{ id: string }>,
): boolean {
  if (PATHS_THAT_ENFORCE_EVERY_BLOCKER.has(path)) return false;
  return canContinueAnyway(blockers);
}

/** Builds a blocker modal that offers "Continue anyway" only when the path lets it work. */
export function buildBlockerModal(
  blockers: BlockerData[],
  path: AdvancePath,
  continueAnyway?: () => void,
): BlockerModal {
  return canContinueAnywayOnPath(path, blockers) && continueAnyway
    ? { blockers, pendingAction: continueAnyway }
    : { blockers };
}

/**
 * The match mode an advance runs with: an unemployed manager always delegates.
 * Continue, the skip pre-checks and the Home blocker refresh all resolve the
 * mode through here so they ask the backend the same question.
 */
export function resolveAdvanceMode(isUnemployed: boolean, requestedMode: string): string {
  return isUnemployed ? "delegate" : requestedMode;
}

