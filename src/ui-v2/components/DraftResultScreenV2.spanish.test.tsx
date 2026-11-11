import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import DraftResultScreenV2 from "@/ui-v2/components/DraftResultScreenV2";
import type { DraftMatchResult } from "@/ui-v2/_legacy/components/match/draftResultSimulator";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

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

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("DraftResultScreenV2 in the Spanish UI", () => {
  it("labels the final button of a finished match in Spanish", () => {
    const result = createResult();
    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={result}
        seriesGames={[{ gameIndex: 1, result, winnerSide: result.winnerSide }]}
        seriesLength={1}
        seriesGameIndex={1}
        userSeriesWins={1}
        opponentSeriesWins={0}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Continuar" })).toBeInTheDocument();
    expect(screen.queryByText(/^Continue$/i)).toBeNull();
  });

  it("labels the next game of an open series in Spanish", () => {
    const gameOne = createResult({ winnerSide: "blue" });
    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={gameOne}
        seriesGames={[{ gameIndex: 1, result: gameOne, winnerSide: gameOne.winnerSide }]}
        seriesLength={3}
        seriesGameIndex={2}
        userSeriesWins={1}
        opponentSeriesWins={0}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Partida 2/3" })).toBeInTheDocument();
    expect(screen.queryByText(/^Game /)).toBeNull();
  });

  it("names the objectives of the match timeline in Spanish", () => {
    const result = createResult({
      timelineEvents: [
        { minute: 4, side: "blue", type: "first_blood", label: "First Blood" },
        { minute: 20, side: "red", type: "elder", label: "Elder Dragon" },
        { minute: 25, side: "blue", type: "inhibitor", label: "Inhibitor" },
        { minute: 30, side: "blue", type: "nexus_turret", label: "Nexus Turret" },
        { minute: 31, side: "blue", type: "nexus", label: "Nexus" },
      ],
    });
    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={result}
        seriesGames={[{ gameIndex: 1, result, winnerSide: result.winnerSide }]}
        seriesLength={1}
        seriesGameIndex={1}
        userSeriesWins={1}
        opponentSeriesWins={0}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Primera sangre")).toBeInTheDocument();
    expect(screen.getByText("Dragón Ancestral")).toBeInTheDocument();
    expect(screen.getByText("Inhibidor")).toBeInTheDocument();
    expect(screen.getByText("Torre del Nexo")).toBeInTheDocument();
    expect(screen.queryByText("Nexus Turret")).toBeNull();
    expect(screen.queryByText("Elder Dragon")).toBeNull();
  });

  it("keeps the stored label for an event type the screen does not know", () => {
    const result = createResult({
      timelineEvents: [
        { minute: 12, side: "red", type: "future_event" as never, label: "Stored label" },
      ],
    });
    render(
      <DraftResultScreenV2
        snapshot={snapshot}
        controlledSide="blue"
        result={result}
        seriesGames={[{ gameIndex: 1, result, winnerSide: result.winnerSide }]}
        seriesLength={1}
        seriesGameIndex={1}
        userSeriesWins={1}
        opponentSeriesWins={0}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Stored label")).toBeInTheDocument();
  });
});
