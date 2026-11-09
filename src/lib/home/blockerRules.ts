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

/** Builds a blocker modal that offers "Continue anyway" only when it can work. */
export function buildBlockerModal(
  blockers: BlockerData[],
  continueAnyway?: () => void,
): BlockerModal {
  return canContinueAnyway(blockers) && continueAnyway
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

