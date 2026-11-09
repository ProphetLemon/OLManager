import { getApiClientSync } from "../api/client";
import type { GameStateData } from "../store/gameStore";

export interface BlockerData {
  id: string;
  severity: string;
  text: string;
  tab: string;
}

export interface AdvanceTimeWithModeResponse {
  action: string;
  game?: GameStateData;
  snapshot?: unknown;
  fixture_index?: number;
  mode?: string;
  round_summary?: unknown;
}

export interface SkipToMatchDayResponse {
  action: string;
  game?: GameStateData;
  blockers?: BlockerData[];
  days_skipped?: number;
  /** True when arriving also played the user's match with the staff auto-draft. */
  match_simulated?: boolean;
}

export async function advanceTimeWithMode(
  mode: string,
): Promise<AdvanceTimeWithModeResponse> {
  return getApiClientSync().time.advance({ mode });
}

export async function checkBlockingActions(
  logContext: string,
): Promise<BlockerData[]> {
  try {
    const blockers = await getApiClientSync().time.checkBlockers();
    console.info(`[useAdvanceTime] ${logContext}:blockers`, {
      count: blockers.length,
      blockers,
    });
    if (blockers.length > 0) {
      console.debug(`[useAdvanceTime] RAW blocker response:`, blockers);
    }
    return blockers;
  } catch (err) {
    console.warn(`[useAdvanceTime] ${logContext}:blockerCheckFailed`, err);
    return [];
  }
}

export async function skipToMatchDay(): Promise<SkipToMatchDayResponse> {
  return getApiClientSync().time.skipToMatchDay();
}
