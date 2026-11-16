import type { LolSimV1MatchReportInput } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

/** Arguments of the `record_series_game` command. */
export type RecordSeriesGameArgs = {
  /** 1-based position of the game in the series. */
  gameNumber: number;
  lolReport: LolSimV1MatchReportInput;
};

type RecordSeriesGameParams = RecordSeriesGameArgs & {
  record: (args: RecordSeriesGameArgs) => Promise<unknown>;
};

/**
 * Hands the backend the report of a series game that did not decide the series, so the
 * final `finish_live_match` can store the true series score and every game's statistics.
 * Resolves true when the backend took it. A failure is logged and never blocks the stage
 * change: the backend then falls back to the deciding game alone, as before this command.
 */
export async function recordSeriesGame({ record, gameNumber, lolReport }: RecordSeriesGameParams): Promise<boolean> {
  try {
    await record({ gameNumber, lolReport });
    return true;
  } catch (error) {
    console.error("Failed to record the series game:", error);
    return false;
  }
}

/**
 * Wraps a handler so a second call made while the first is still running is ignored.
 * The end-of-game Continue now waits for the backend, so a double click would otherwise
 * run the handler twice and count one game as two. `busy` is a ref so it survives renders.
 */
export function guardReentry<A extends unknown[]>(
  busy: { current: boolean },
  run: (...args: A) => Promise<void> | void,
): (...args: A) => void {
  return (...args: A) => {
    if (busy.current) return;
    busy.current = true;
    let pending: Promise<void> | void;
    try {
      pending = run(...args);
    } catch (error) {
      busy.current = false;
      throw error;
    }
    void Promise.resolve(pending).finally(() => {
      busy.current = false;
    });
  };
}

interface SettleSeriesGameParams {
  /** True when this game decided the series (or is the only game). */
  seriesComplete: boolean;
  /** 1-based position of this game in the series. */
  gameNumber: number;
  lolReport: LolSimV1MatchReportInput;
  record: (args: RecordSeriesGameArgs) => Promise<unknown>;
  /** Finishes the live match with the deciding game; resolves false when that failed. */
  finalize: (lolReport: LolSimV1MatchReportInput, gameNumber: number) => Promise<boolean>;
  /** Moves on to the next stage once the backend has the game. */
  onSettled: () => void;
}

/**
 * What happens to a finished game: the deciding one finishes the match, any other is
 * recorded for the backend to merge later. The stage only advances once that is done.
 */
export async function settleSeriesGame({ seriesComplete, gameNumber, lolReport, record, finalize, onSettled }: SettleSeriesGameParams): Promise<void> {
  if (seriesComplete) {
    if (await finalize(lolReport, gameNumber)) onSettled();
    return;
  }
  await recordSeriesGame({ record, gameNumber, lolReport });
  onSettled();
}
