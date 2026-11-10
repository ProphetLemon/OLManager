import { getApiClientSync } from "../api/client";
import { SCRIM_BLOCKER_IDS } from "@/lib/home/blockerRules";
import { scrimBlockerText } from "@/lib/home/scrimBlockerText";
import { backendBlockerText } from "@/lib/home/advanceBlockerText";
import type { GameStateData } from "../store/gameStore";

export interface BlockerData {
  id: string;
  severity: string;
  text: string;
  tab: string;
  /** Values behind `text`; the interface words the blocker from them. */
  params?: Record<string, string | number>;
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

/**
 * The backend words its blockers in English (or, for some roster ones, in Spanish);
 * show them through i18n. A blocker with no wording of its own keeps the text the
 * backend sent.
 */
export function localizeAdvanceBlocker(blocker: BlockerData): BlockerData {
  if (SCRIM_BLOCKER_IDS.has(blocker.id)) {
    return { ...blocker, text: scrimBlockerText(blocker.id) };
  }
  const text = backendBlockerText(blocker);
  return text === null ? blocker : { ...blocker, text };
}

export interface CheckBlockingOptions {
  /**
   * Rethrow a failed check instead of answering `[]`. Callers that keep state
   * between checks need this so "the check failed" is not read as "all resolved".
   */
  rethrow?: boolean;
  /** Match mode the advance would run with; the backend defaults to "live". */
  mode?: string;
  /** Set to false for `skip_to_match_day`, which never raises the scrim stops. */
  includeScrimStops?: boolean;
}

export async function checkBlockingActions(
  logContext: string,
  options: CheckBlockingOptions = {},
): Promise<BlockerData[]> {
  try {
    const { mode, includeScrimStops } = options;
    const raw = await getApiClientSync().time.checkBlockers({ mode, includeScrimStops });
    const blockers = raw.map(localizeAdvanceBlocker);
    console.info(`[useAdvanceTime] ${logContext}:blockers`, {
      count: blockers.length,
      mode,
      blockers,
    });
    if (blockers.length > 0) {
      console.debug(`[useAdvanceTime] RAW blocker response:`, blockers);
    }
    return blockers;
  } catch (err) {
    console.warn(`[useAdvanceTime] ${logContext}:blockerCheckFailed`, err);
    if (options.rethrow) throw err;
    return [];
  }
}

export async function skipToMatchDay(): Promise<SkipToMatchDayResponse> {
  const response = await getApiClientSync().time.skipToMatchDay();
  return response.blockers
    ? { ...response, blockers: response.blockers.map(localizeAdvanceBlocker) }
    : response;
}
