/**
 * Where a best-of series stands after a game, as the result screen needs it. Pure. The score the
 * flow passes in and the list of games played can disagree (a stored fixture, a resumed series), so
 * the games win whenever the passed score claims more than they can support.
 */

type Side = "blue" | "red";

export interface SeriesGame {
  gameIndex: number;
  winnerSide?: Side;
}

export interface SeriesStatusInput {
  /** The side the manager played. */
  controlledSide: Side;
  seriesLength: 1 | 3 | 5;
  seriesGameIndex: number;
  userSeriesWins: number;
  opponentSeriesWins: number;
  /** Games played so far; may be empty, then the current game stands alone. */
  games: ReadonlyArray<SeriesGame>;
  currentWinner: Side;
}

export interface SeriesStatus {
  games: SeriesGame[];
  userWins: number;
  opponentWins: number;
  targetWins: number;
  finished: boolean;
  /** "2/3": the game the Continue button leads to, never past the length of the series. */
  nextGameLabel: string;
}

export function seriesStatus(input: SeriesStatusInput): SeriesStatus {
  const { controlledSide, seriesLength, userSeriesWins, opponentSeriesWins } = input;
  const listed = input.games.filter((entry) => Number.isFinite(entry.gameIndex) && entry.gameIndex >= 1).sort((a, b) => a.gameIndex - b.gameIndex);
  const games: SeriesGame[] = listed.length > 0 ? listed : [{ gameIndex: Math.max(1, input.seriesGameIndex), winnerSide: input.currentWinner }];

  const latest = games[games.length - 1];
  const played = Math.max(latest?.gameIndex ?? 1, games.length);
  const nextGameLabel = `${Math.min(seriesLength, played + 1)}/${seriesLength}`;
  const targetWins = seriesLength === 1 ? 1 : seriesLength === 3 ? 2 : 3;

  const fromGames = games.reduce(
    (score, entry) => {
      if (entry.winnerSide === controlledSide) return { ...score, user: score.user + 1 };
      if (entry.winnerSide === "blue" || entry.winnerSide === "red") return { ...score, opponent: score.opponent + 1 };
      return score;
    },
    { user: 0, opponent: 0 },
  );
  const passedWins = userSeriesWins + opponentSeriesWins;
  const gameWins = fromGames.user + fromGames.opponent;
  const passedClaimsFinish = userSeriesWins >= targetWins || opponentSeriesWins >= targetWins;
  const passedSupported = passedClaimsFinish && passedWins <= seriesLength && gameWins >= passedWins;
  const useGames = seriesLength > 1 && gameWins > 0 && (passedWins === 0 || !passedSupported);
  const userWins = useGames ? fromGames.user : userSeriesWins;
  const opponentWins = useGames ? fromGames.opponent : opponentSeriesWins;
  const reached = userWins >= targetWins || opponentWins >= targetWins;
  const supported = userWins + opponentWins <= seriesLength && gameWins >= userWins + opponentWins;

  return { games, userWins, opponentWins, targetWins, finished: seriesLength === 1 || (reached && supported), nextGameLabel };
}
