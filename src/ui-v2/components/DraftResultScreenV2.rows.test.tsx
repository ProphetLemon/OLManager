import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import DraftResultScreenV2 from "@/ui-v2/components/DraftResultScreenV2";
import type { DraftMatchResult, DraftPlayerResult } from "@/ui-v2/_legacy/components/match/draftResultSimulator";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

vi.mock("@/lib/teams/teamLogos", () => ({ resolveTeamLogo: () => null }));
vi.mock("@/lib/players/playerPhotos", () => ({ resolvePlayerPhoto: () => null }));

function row(over: Partial<DraftPlayerResult> = {}): DraftPlayerResult {
  return {
    side: "blue",
    playerId: "b-mid",
    playerName: "Blue Mid",
    role: "MID",
    championId: "Ahri",
    kills: 3,
    deaths: 1,
    assists: 5,
    gold: 1225,
    spentGold: 10400,
    damageDealt: 23456,
    rating: 8.4,
    ...over,
  };
}

function result(playerResults: DraftPlayerResult[]): DraftMatchResult {
  return {
    winnerSide: "blue",
    durationMinutes: 32,
    blueKills: 15,
    redKills: 9,
    mvp: playerResults[0],
    playerResults,
    goldDiffTimeline: [],
    timelineEvents: [],
    objectives: {
      blue: { voidgrubs: 0, dragons: 2, dragonSoul: false, elderDragons: 0, heralds: 1, barons: 1, towers: 8, inhibitors: 2 },
      red: { voidgrubs: 0, dragons: 1, dragonSoul: false, elderDragons: 0, heralds: 0, barons: 0, towers: 3, inhibitors: 0 },
    },
    power: { blue: 70, red: 55, diff: 15, autoWin: false, winProbBlue: 61 },
  };
}

const snapshot = {
  home_team: { id: "team-1", name: "Alpha FC", players: [] },
  away_team: { id: "team-2", name: "Beta FC", players: [] },
} as unknown as MatchSnapshot;

function renderRows(playerResults: DraftPlayerResult[]) {
  const value = result(playerResults);
  return render(
    <DraftResultScreenV2
      snapshot={snapshot}
      controlledSide="blue"
      result={value}
      seriesGames={[{ gameIndex: 1, result: value, winnerSide: "blue" }]}
      seriesLength={1}
      seriesGameIndex={1}
      userSeriesWins={1}
      opponentSeriesWins={0}
      onContinue={vi.fn()}
    />,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("player rows on the post-match screen", () => {
  it("shows the gold earned (in hand plus spent) in the compact form of the live card", () => {
    renderRows([row(), row({ side: "red", playerId: "r-mid", playerName: "Red Mid", gold: 300, spentGold: 9000 })]);
    const [blue, red] = screen.getAllByTestId("row-gold");
    expect(blue).toHaveTextContent("11,6k");
    expect(red).toHaveTextContent("9,3k");
  });

  it("shows the gold in hand for a result stored before the gold spent was kept", () => {
    renderRows([row({ gold: 640, spentGold: undefined })]);
    expect(screen.getByTestId("row-gold")).toHaveTextContent("640");
  });

  it("labels the gold, damage and rating columns with visible text, once per team", () => {
    renderRows([row(), row({ side: "red", playerId: "r-mid", playerName: "Red Mid" })]);
    const headers = screen.getAllByTestId("row-columns");
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(within(header).getByText("Oro")).toBeVisible();
      expect(within(header).getByText("Daño")).toBeVisible();
      expect(within(header).getByText("Nota")).toBeVisible();
    }
  });

  it("names the gold and the rating of a row for assistive tech, like the damage", () => {
    renderRows([row()]);
    expect(screen.getByTestId("row-gold")).toHaveAttribute("aria-label", "Oro obtenido: 11,6k");
    expect(screen.getByTestId("row-rating")).toHaveAttribute("aria-label", "Nota: 8,4");
    expect(screen.getByTestId("row-rating")).toHaveTextContent("8,4");
    expect(screen.getByTestId("row-damage")).toHaveAttribute("aria-label", "Daño infligido: 23,5k");
  });
});
