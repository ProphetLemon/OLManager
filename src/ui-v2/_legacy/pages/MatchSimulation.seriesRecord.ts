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
