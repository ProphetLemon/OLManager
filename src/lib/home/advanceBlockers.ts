import {
  checkBlockingActions,
  type BlockerData,
  type CheckBlockingOptions,
} from "@/services/advanceTimeService";
import { SCRIM_BLOCKER_IDS } from "./blockerRules";

export interface CollectAdvanceBlockersOptions extends CheckBlockingOptions {
  /** Assistant Coach clears the scrim stops itself, so they are not shown. */
  assistantResolvesScrims?: boolean;
}

/**
 * What blocks the advance, straight from the backend (the single source of
 * truth shared with `advance_time_with_mode`). With the Assistant Coach on,
 * the scrim stops it resolves automatically are left out.
 */
export async function collectAdvanceBlockers(
  logContext: string,
  options: CollectAdvanceBlockersOptions = {},
): Promise<BlockerData[]> {
  const { assistantResolvesScrims, ...checkOptions } = options;
  const blockers = await checkBlockingActions(logContext, checkOptions);
  return assistantResolvesScrims
    ? blockers.filter((blocker) => !SCRIM_BLOCKER_IDS.has(blocker.id))
    : blockers;
}
