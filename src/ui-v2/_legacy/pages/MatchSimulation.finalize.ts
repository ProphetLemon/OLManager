import type { GameStateData } from "@/store/gameStore";

export interface FinishLiveMatchResponse {
  game: GameStateData;
  round_summary?: unknown;
}

interface FinalizeLiveMatchParams {
  finish: () => Promise<FinishLiveMatchResponse>;
  /** Null when there is no draft to persist (for example a skipped or report-less finish). */
  recordPicks: (() => Promise<GameStateData>) | null;
  /** Reloads the game from the backend when the finish response was lost (already finalized). */
  refetchGame: () => Promise<GameStateData>;
  onGame: (game: GameStateData) => void;
}

const NO_ACTIVE_LIVE_MATCH = "No active live match";

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The backend takes the live session when it finishes, so a retry reports that no session
 * is active. That means the match was already finalized, not that it failed.
 */
export function isAlreadyFinalizedError(error: unknown): boolean {
  return errorMessage(error).includes(NO_ACTIVE_LIVE_MATCH);
}

/**
 * Finishes the live backend session and persists the champion picks.
 * Resolves true when the match is finalized (including "already finalized") so the caller
 * can advance the stage; real finish errors resolve false. A failing picks call is logged
 * and never blocks the stage change.
 */
export async function finalizeLiveMatch({ finish, recordPicks, refetchGame, onGame }: FinalizeLiveMatchParams): Promise<boolean> {
  try {
    const response = await finish();
    onGame(response.game);
  } catch (error) {
    if (!isAlreadyFinalizedError(error)) {
      console.error("Failed to finish match:", error);
      return false;
    }
    console.info("[MatchSimulation] finalizeMatch:alreadyFinalized");
    try {
      onGame(await refetchGame());
    } catch (refetchError) {
      console.error("Failed to refresh the game after an already-finalized match:", refetchError);
    }
  }

  if (recordPicks) {
    try {
      onGame(await recordPicks());
    } catch (error) {
      console.error("Failed to record champion picks:", error);
    }
  }
  return true;
}
