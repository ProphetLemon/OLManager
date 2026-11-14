import { useMemo } from "react";

import { seriesStatus, type SeriesGame } from "@/lib/match/live/seriesStatus";
import type { GameStateData } from "@/store/gameStore";
import type { DraftMatchResult } from "@/ui-v2/_legacy/components/match/draftResultSimulator";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import PostGame from "./PostGame";
import type { ChampionSelectionByPlayer } from "./live/useChampionProfiles";

export interface DraftResultStageProps {
  snapshot: MatchSnapshot;
  gameState: GameStateData | null;
  /** The side the manager played this game. */
  controlledSide: "blue" | "red";
  /** The state a watched match finished in, with its record; the empty state a simulation hands on, or null. */
  finalRuntimeState: LolSimV1RuntimeState | null;
  /** The result of the game: built from the finished state, or the simulation's own. */
  result: DraftMatchResult | null;
  championSelections?: ChampionSelectionByPlayer | null;
  seriesGames?: SeriesGame[];
  seriesLength?: 1 | 3 | 5;
  seriesGameIndex?: number;
  userSeriesWins?: number;
  opponentSeriesWins?: number;
  /** The next game of an unfinished series, or the end of the match. The flow decides which. */
  onContinue: (nextUserSide?: "blue" | "red") => void;
  /** Offered only once the series is over. */
  onPressConference?: () => void;
}

/**
 * The screen after a game, in the match flow's `draft_result` stage: the post-game screen with the
 * series pieces the flow needs (score, game number, next game or finish). The flow's handlers are
 * the ones the stage always had; this only decides what is shown and which label the button wears.
 */
export default function DraftResultStage({
  snapshot,
  gameState,
  controlledSide,
  finalRuntimeState,
  result,
  championSelections,
  seriesGames = [],
  seriesLength = 1,
  seriesGameIndex = 1,
  userSeriesWins = 0,
  opponentSeriesWins = 0,
  onContinue,
  onPressConference,
}: DraftResultStageProps) {
  const status = useMemo(
    () =>
      seriesStatus({
        controlledSide,
        seriesLength,
        seriesGameIndex,
        userSeriesWins,
        opponentSeriesWins,
        games: seriesGames,
        currentWinner: result?.winnerSide ?? finalRuntimeState?.winner ?? "blue",
      }),
    [controlledSide, finalRuntimeState?.winner, opponentSeriesWins, result?.winnerSide, seriesGameIndex, seriesGames, seriesLength, userSeriesWins],
  );
  return (
    <PostGame
      snapshot={snapshot}
      gameState={gameState}
      userSide={controlledSide === "red" ? "Away" : "Home"}
      finalRuntimeState={finalRuntimeState}
      result={result}
      championSelections={championSelections}
      series={{ length: seriesLength, status }}
      onFinish={() => onContinue()}
      onPressConference={status.finished ? onPressConference : undefined}
    />
  );
}
