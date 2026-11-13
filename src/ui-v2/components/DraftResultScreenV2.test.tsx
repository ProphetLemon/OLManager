import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DraftResultScreenV2, {
  buildGoldAdvantageChartPoints,
  type DraftResultSeriesGame,
} from "@/ui-v2/components/DraftResultScreenV2";
import type { DraftMatchResult } from "@/ui-v2/_legacy/components/match/draftResultSimulator";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
      if (typeof options === "string") {
        return options;
      }

      if (options && typeof options === "object" && "defaultValue" in options) {
        return String(options.defaultValue ?? key).replace(/{{(\w+)}}/g, (_, name) =>
          String(options[name] ?? ""),
        );
      }

      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@/lib/teams/teamLogos", () => ({
  resolveTeamLogo: () => null,
}));

vi.mock("@/lib/players/playerPhotos", () => ({
  resolvePlayerPhoto: () => null,
}));

function createResult(overrides: Partial<DraftMatchResult> = {}): DraftMatchResult {
  return {
    winnerSide: "blue",
    durationMinutes: 32,
    blueKills: 15,
    redKills: 9,
    mvp: {
      side: "blue",
      playerId: "blue-top",
      playerName: "Blue Top",
      role: "TOP",
      championId: "Aatrox",
      kills: 7,
      deaths: 1,
      assists: 6,
      gold: 14000,
      rating: 9.2,
    },
    playerResults: [],
    goldDiffTimeline: [],
    timelineEvents: [],
    objectives: {
      blue: {
        voidgrubs: 0,
        dragons: 2,
        dragonSoul: false,
        elderDragons: 0,
        heralds: 1,
        barons: 1,
        towers: 8,
        inhibitors: 2,
      },
      red: {
        voidgrubs: 0,
        dragons: 1,
        dragonSoul: false,
        elderDragons: 0,
        heralds: 0,
        barons: 0,
        towers: 3,
        inhibitors: 0,
      },
    },
    power: {
      blue: 70,
      red: 55,
      diff: 15,
      autoWin: false,
      winProbBlue: 61,
    },
    ...overrides,
  };
}

const snapshot = {
  home_team: { id: "team-1", name: "Alpha FC", players: [] },
  away_team: { id: "team-2", name: "Beta FC", players: [] },
} as unknown as MatchSnapshot;

describe("DraftResultScreenV2", () => {
  it("renders game tabs and switches displayed game result", () => {
    const gameOne = createResult({
      blueKills: 22,
      redKills: 14,
      mvp: {
        side: "blue",
        playerId: "alpha-mid",
        playerName: "Alpha Mid",
        role: "MID",
        championId: "Ahri",
        kills: 12,
        deaths: 2,
        assists: 7,
        gold: 16800,
        rating: 9.7,
      },
    });

    const gameTwo = createResult({
      blueKills: 9,
      redKills: 3,
      mvp: {
        side: "blue",
        playerId: "alpha-jungle",
        playerName: "Alpha Jungle",
        role: "JUNGLE",
        championId: "LeeSin",
        kills: 6,
        deaths: 1,
        assists: 8,
        gold: 13200,
        rating: 9.1,
      },
    });

    const seriesGames: DraftResultSeriesGame[] = [
      { gameIndex: 1, result: gameOne, winnerSide: gameOne.winnerSide },
      { gameIndex: 2, result: gameTwo, winnerSide: gameTwo.winnerSide },
    ];

    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={gameTwo}
        seriesGames={seriesGames}
        seriesLength={3}
        seriesGameIndex={2}
        userSeriesWins={2}
        opponentSeriesWins={0}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Game 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Game 2" })).toBeInTheDocument();
    // Game 2 is selected by default and shows its score
    expect(screen.getAllByText("9").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Game 1" }));

    // Game 1 score should now be visible
    expect(screen.getAllByText("22").length).toBeGreaterThan(0);
  });

  it("shows the next game label while a Bo3 series is unfinished", () => {
    const gameOne = createResult({ winnerSide: "blue" });
    const gameTwo = createResult({ winnerSide: "red" });
    const onContinue = vi.fn();

    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={gameTwo}
        seriesGames={[
          { gameIndex: 1, result: gameOne, winnerSide: gameOne.winnerSide },
          { gameIndex: 2, result: gameTwo, winnerSide: gameTwo.winnerSide },
        ]}
        seriesLength={3}
        seriesGameIndex={2}
        userSeriesWins={1}
        opponentSeriesWins={1}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByRole("button", { name: "Game 3/3" })).toBeInTheDocument();
  });

  it("shows Game 2/3 instead of final continue when a Bo3 has only one played map", () => {
    const gameOne = createResult({ winnerSide: "blue" });

    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={gameOne}
        seriesGames={[{ gameIndex: 1, result: gameOne, winnerSide: gameOne.winnerSide }]}
        seriesLength={3}
        seriesGameIndex={2}
        userSeriesWins={2}
        opponentSeriesWins={0}
        onPressConference={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText(/match\.draftResult\.series \(Bo3\) · 1 - 0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Game 2/3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Press Conference" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("does not show a stale next game label after all Bo3 games were played", () => {
    const gameOne = createResult({ winnerSide: "red" });
    const gameTwo = createResult({ winnerSide: "blue" });
    const gameThree = createResult({ winnerSide: "blue" });

    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={gameThree}
        seriesGames={[
          { gameIndex: 1, result: gameOne, winnerSide: gameOne.winnerSide },
          { gameIndex: 2, result: gameTwo, winnerSide: gameTwo.winnerSide },
          { gameIndex: 3, result: gameThree, winnerSide: gameThree.winnerSide },
        ]}
        seriesLength={3}
        seriesGameIndex={1}
        userSeriesWins={1}
        opponentSeriesWins={1}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Game 2/3" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("keeps the final Bo3 series score visible when upstream win props are reset", () => {
    const gameOne = createResult({ winnerSide: "red" });
    const gameTwo = createResult({ winnerSide: "blue" });
    const gameThree = createResult({ winnerSide: "blue" });

    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={gameThree}
        seriesGames={[
          { gameIndex: 1, result: gameOne, winnerSide: gameOne.winnerSide },
          { gameIndex: 2, result: gameTwo, winnerSide: gameTwo.winnerSide },
          { gameIndex: 3, result: gameThree, winnerSide: gameThree.winnerSide },
        ]}
        seriesLength={3}
        seriesGameIndex={3}
        userSeriesWins={0}
        opponentSeriesWins={0}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText(/match\.draftResult\.series \(Bo3\) · 2 - 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Game 3/3" })).not.toBeInTheDocument();
  });

  it("plots blue gold advantage above center and red advantage below center", () => {
    const result = createResult({
      goldDiffTimeline: [
        { minute: 0, diff: -1000 },
        { minute: 10, diff: 0 },
        { minute: 20, diff: 1000 },
      ],
    });

    const { container } = render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={result}
        onContinue={vi.fn()}
      />,
    );

    expect(
      screen.getAllByLabelText("match.draftResult.goldAdvantage (+ AF, - BF)").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("+ AF")).toBeInTheDocument();
    expect(screen.getByText("- BF")).toBeInTheDocument();

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")).toBe("6,64 50,36 94,8");
  });

  it("maps blue advantage climbing up and red comeback falling below center", () => {
    const chartPoints = buildGoldAdvantageChartPoints([
      { minute: 0, diff: 1000 },
      { minute: 10, diff: 2000 },
      { minute: 20, diff: 500 },
      { minute: 30, diff: -500 },
      { minute: 40, diff: -1500 },
    ]);

    expect(chartPoints.map(({ x, y }) => `${x},${y}`)).toEqual([
      "6,22",
      "28,8",
      "50,29",
      "72,43",
      "94,57",
    ]);

    expect(chartPoints[1].y).toBeLessThan(chartPoints[0].y);
    expect(chartPoints[2].y).toBeGreaterThan(chartPoints[1].y);
    expect(chartPoints[3].y).toBeGreaterThan(36);
    expect(chartPoints[4].y).toBeGreaterThan(chartPoints[3].y);
  });

  it("uses chronological minutes instead of input order for the gold chart", () => {
    const chartPoints = buildGoldAdvantageChartPoints([
      { minute: 20, diff: 500 },
      { minute: 0, diff: 1000 },
      { minute: 40, diff: -1500 },
      { minute: 10, diff: 2000 },
      { minute: 30, diff: -500 },
    ]);

    expect(chartPoints.map((point) => point.minute)).toEqual([0, 10, 20, 30, 40]);
    expect(chartPoints.map(({ x, y }) => `${x},${y}`)).toEqual([
      "6,22",
      "28,8",
      "50,29",
      "72,43",
      "94,57",
    ]);
  });

  it("shows scrim prep influence when the runtime snapshot carried prep signal", () => {
    render(
      <DraftResultScreenV2
        snapshot={{
          ...snapshot,
          lol_scrim_prep: {
            home: { preparation: 2, focus: "Macro", comfortByPlayer: { "blue-top": 1 } },
            away: { preparation: 0, focus: null, comfortByPlayer: {} },
          },
        }}
        controlledSide="blue"
        result={createResult()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Scrim prep carried into the match")).toBeInTheDocument();
    expect(screen.getByText("Opponent prep +2")).toBeInTheDocument();
    expect(screen.getByText("Champion comfort +1")).toBeInTheDocument();
    expect(screen.getByText("Focus: macro")).toBeInTheDocument();
  });
});
