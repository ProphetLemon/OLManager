import { describe, expect, it } from "vitest";

import { seriesStatus } from "./seriesStatus";

const game = (gameIndex: number, winnerSide?: "blue" | "red") => ({ gameIndex, winnerSide });

describe("seriesStatus", () => {
  it("is finished at once for a single game, with no next game", () => {
    expect(seriesStatus({ controlledSide: "blue", seriesLength: 1, seriesGameIndex: 1, userSeriesWins: 1, opponentSeriesWins: 0, games: [], currentWinner: "blue" })).toMatchObject({
      finished: true,
      userWins: 1,
      opponentWins: 0,
    });
  });

  it("is not finished after game 1 of a best of 3, and names game 2 as the next", () => {
    const status = seriesStatus({ controlledSide: "blue", seriesLength: 3, seriesGameIndex: 1, userSeriesWins: 1, opponentSeriesWins: 0, games: [game(1, "blue")], currentWinner: "blue" });
    expect(status).toMatchObject({ finished: false, userWins: 1, opponentWins: 0, nextGameLabel: "2/3", targetWins: 2 });
  });

  it("is finished when a side reaches the wins the series needs, and the next label never passes the length", () => {
    const status = seriesStatus({ controlledSide: "blue", seriesLength: 3, seriesGameIndex: 2, userSeriesWins: 2, opponentSeriesWins: 0, games: [game(1, "blue"), game(2, "blue")], currentWinner: "blue" });
    expect(status.finished).toBe(true);
    expect(status.nextGameLabel).toBe("3/3");
  });

  it("counts a loss for the manager when the manager played red and blue won", () => {
    const status = seriesStatus({ controlledSide: "red", seriesLength: 3, seriesGameIndex: 1, userSeriesWins: 0, opponentSeriesWins: 1, games: [game(1, "blue")], currentWinner: "blue" });
    expect(status).toMatchObject({ userWins: 0, opponentWins: 1, finished: false });
  });

  it("trusts the games played over a score nothing supports: a claimed finish with one game recorded is not a finish", () => {
    const status = seriesStatus({ controlledSide: "blue", seriesLength: 5, seriesGameIndex: 1, userSeriesWins: 3, opponentSeriesWins: 0, games: [game(1, "blue")], currentWinner: "blue" });
    expect(status).toMatchObject({ userWins: 1, opponentWins: 0, finished: false });
  });

  it("builds the one game of a match that has no list of games from the current result", () => {
    const status = seriesStatus({ controlledSide: "blue", seriesLength: 3, seriesGameIndex: 2, userSeriesWins: 0, opponentSeriesWins: 0, games: [], currentWinner: "red" });
    expect(status.games).toEqual([{ gameIndex: 2, winnerSide: "red" }]);
    expect(status).toMatchObject({ userWins: 0, opponentWins: 1 });
  });

  it("sorts the games and drops the ones with no valid number", () => {
    const status = seriesStatus({ controlledSide: "blue", seriesLength: 3, seriesGameIndex: 2, userSeriesWins: 1, opponentSeriesWins: 1, games: [game(2, "red"), game(0, "blue"), game(1, "blue")], currentWinner: "red" });
    expect(status.games.map((entry) => entry.gameIndex)).toEqual([1, 2]);
  });
});
