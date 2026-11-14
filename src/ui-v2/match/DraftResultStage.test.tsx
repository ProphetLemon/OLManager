import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { finishedMatch } from "@/lib/match/live/postGameFixtures.testing";
import type { GameStateData } from "@/store/gameStore";
import type { DraftMatchResult } from "@/ui-v2/_legacy/components/match/draftResultSimulator";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import DraftResultStage, { type DraftResultStageProps } from "./DraftResultStage";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const snapshot = {
  home_team: { id: "shi", name: "Shifters", players: [] },
  away_team: { id: "mkoi", name: "Movistar KOI", players: [] },
  current_minute: 28,
} as unknown as MatchSnapshot;
const gameState = { teams: [] } as unknown as GameStateData;

const player = (side: "blue" | "red", id: string, role: string) => ({
  side,
  playerId: id,
  playerName: id.toUpperCase(),
  role,
  championId: "Jinx",
  kills: 4,
  deaths: 1,
  assists: 6,
  gold: 400,
  spentGold: 9100,
  damageDealt: 15000,
  rating: 7,
});
const objectives = { voidgrubs: 2, dragons: 3, dragonSoul: false, elderDragons: 0, heralds: 1, barons: 1, towers: 6, inhibitors: 1 };
const simulated = {
  winnerSide: "blue",
  durationMinutes: 28,
  blueKills: 14,
  redKills: 9,
  mvp: player("blue", "b-adc", "ADC"),
  playerResults: [player("blue", "b-adc", "ADC"), player("blue", "b-top", "TOP"), player("red", "r-top", "TOP"), player("red", "r-adc", "ADC")],
  goldDiffTimeline: [
    { minute: 0, diff: 0 },
    { minute: 28, diff: 4000 },
  ],
  timelineEvents: [{ minute: 3, side: "blue", type: "first_blood", label: "First Blood" }],
  objectives: { blue: objectives, red: objectives },
  power: { blue: 1, red: 1, diff: 0, autoWin: false, winProbBlue: 50 },
} as unknown as DraftMatchResult;

const watched = () => finishedMatch() as unknown as LolSimV1RuntimeState;
const emptyState = () => finishedMatch({ champions: [], matchRecord: undefined }) as unknown as LolSimV1RuntimeState;

function show(over: Partial<DraftResultStageProps> = {}) {
  const onContinue = vi.fn();
  const onPressConference = vi.fn();
  render(
    <DraftResultStage
      snapshot={snapshot}
      gameState={gameState}
      controlledSide="blue"
      finalRuntimeState={watched()}
      result={simulated}
      onContinue={onContinue}
      onPressConference={onPressConference}
      {...over}
    />,
  );
  return { onContinue, onPressConference };
}

describe("DraftResultStage after a watched match", () => {
  it("shows the post-game screen with what the live screen recorded", () => {
    show();
    expect(screen.getByTestId("post-game")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Shifters players" });
    // Items and levels come from the played-out state, not the simulation's result.
    expect(within(table).getAllByText("18").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("radio", { name: "Graphs" }));
    expect(screen.getAllByTestId("gold-line")).toHaveLength(1);
  });

  it("is a single game: no series strip, Continue, and the press conference where it was", () => {
    const { onContinue, onPressConference } = show();
    expect(screen.queryByTestId("post-game-series")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Press Conference" }));
    expect(onPressConference).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith();
  });
});

describe("DraftResultStage after a simulated match", () => {
  const simulatedProps = { finalRuntimeState: emptyState() };

  it("shows the scoreboard from the simulation's result, without the columns it cannot fill", () => {
    show(simulatedProps);
    const table = screen.getByRole("table", { name: "Shifters players" });
    // Header, two players, the totals and, with no items column to hold them, the objectives row.
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(within(table).getAllByText("4/1/6").length).toBeGreaterThan(0);
    expect(within(table).queryByRole("columnheader", { name: "Level" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "CS" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Items and trinket" })).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Damage" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "MVP: B-ADC" })).toBeInTheDocument();
  });

  it("does not draw the gold line, which needs a record, and says so; the bars are still there", () => {
    show(simulatedProps);
    fireEvent.click(screen.getByRole("radio", { name: "Graphs" }));
    expect(screen.queryByTestId("gold-line")).not.toBeInTheDocument();
    expect(screen.getByText("The gold difference of this match was not recorded.")).toBeInTheDocument();
    expect(screen.getByTestId("damage-chart")).toBeInTheDocument();
  });

  it("lists the simulator's events in the language of the screen", async () => {
    show(simulatedProps);
    fireEvent.click(screen.getByRole("radio", { name: "Timeline" }));
    expect(screen.getByText("First Blood")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-partial")).not.toBeInTheDocument();
  });

  it("works with no state at all, only the result", () => {
    show({ finalRuntimeState: null });
    expect(screen.getByRole("table", { name: "Shifters players" })).toBeInTheDocument();
  });
});

describe("DraftResultStage in a best-of series", () => {
  const game = (gameIndex: number, winnerSide: "blue" | "red") => ({ gameIndex, winnerSide });

  it("after game 1 of a best of 3 shows the score and the games, leads to game 2 and hides the press conference", () => {
    const { onContinue } = show({ seriesLength: 3, seriesGameIndex: 1, userSeriesWins: 1, opponentSeriesWins: 0, seriesGames: [game(1, "blue")] });
    const strip = screen.getByTestId("post-game-series");
    expect(strip).toHaveTextContent("Series (Bo3) · 1 - 0");
    expect(strip).toHaveTextContent("Game 1");
    expect(screen.queryByRole("button", { name: "Press Conference" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Game 2/3" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("after the last game finishes the series: Continue, the press conference, and the final score", () => {
    const { onContinue, onPressConference } = show({
      seriesLength: 3,
      seriesGameIndex: 2,
      userSeriesWins: 2,
      opponentSeriesWins: 0,
      seriesGames: [game(1, "blue"), game(2, "blue")],
    });
    expect(screen.getByTestId("post-game-series")).toHaveTextContent("Series (Bo3) · 2 - 0");
    fireEvent.click(screen.getByRole("button", { name: "Press Conference" }));
    expect(onPressConference).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Game 3/3" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("counts the series from the manager's side when the manager played red", () => {
    show({ controlledSide: "red", seriesLength: 3, seriesGameIndex: 1, userSeriesWins: 0, opponentSeriesWins: 1, seriesGames: [game(1, "blue")] });
    expect(screen.getByTestId("post-game-series")).toHaveTextContent("Series (Bo3) · 0 - 1");
  });
});
