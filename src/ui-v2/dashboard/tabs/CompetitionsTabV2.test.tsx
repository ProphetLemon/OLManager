import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { CompetitionsTabV2 } from "./CompetitionsTabV2";

function buildState(position: string): GameStateData {
  return {
    leagues: [
      {
        id: "lec-league",
        competition_id: "lec",
        name: "LEC",
        tier: 1,
        active: true,
        season: 1,
        standings: [],
        fixtures: [],
      },
    ],
    teams: [{ id: "t1", name: "Alpha", short_name: "ALP", competition_id: "lec" }],
    players: [
      {
        id: "p1",
        team_id: "t1",
        match_name: "Zed",
        full_name: "Zed Smith",
        position,
        natural_position: position,
        attributes: {},
        lol_role: position,
      },
    ],
  } as unknown as GameStateData;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("CompetitionsTabV2 players table", () => {
  it("shows the translated role label instead of the raw position", () => {
    render(<CompetitionsTabV2 gameState={buildState("JUNGLE")} />);

    fireEvent.click(screen.getByRole("button", { name: /LEC/ }));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("competitions.viewPlayers", { count: 1 }) }));

    expect(screen.getByText("Jungle")).toBeTruthy();
    expect(screen.queryByText("JUNGLE")).toBeNull();
  });
});

describe("CompetitionsTabV2 initial selection", () => {
  it("opens the given competition with its standings view", () => {
    render(<CompetitionsTabV2 gameState={buildState("MID")} initialCompetitionId="lec" />);

    expect(screen.queryByText(i18n.t("competitions.selectPrompt"))).toBeNull();
    expect(screen.getAllByText("LEC").length).toBeGreaterThan(1);
  });
});

describe("CompetitionsTabV2 league header", () => {
  function stateWithFixtures(fixtureCount: number, teamCount: number): GameStateData {
    const state = buildState("MID");
    state.leagues[0].season = 3;
    state.leagues[0].fixtures = Array.from({ length: fixtureCount }, (_, index) => ({
      id: `f${index}`,
      status: "Scheduled",
    })) as never;
    state.teams = Array.from({ length: teamCount }, (_, index) => ({
      id: `t${index}`,
      name: `Team ${index}`,
      short_name: `T${index}`,
      competition_id: "lec",
    })) as never;
    return state;
  }

  it("says the season, the team count and the match count", () => {
    render(<CompetitionsTabV2 gameState={stateWithFixtures(12, 4)} />);

    fireEvent.click(screen.getByRole("button", { name: /LEC/ }));

    expect(screen.getByText("Season 3")).toBeInTheDocument();
    expect(screen.getByText("4 teams")).toBeInTheDocument();
    expect(screen.getByText("12 matches")).toBeInTheDocument();
  });

  it("uses the singular for one team and one match", () => {
    render(<CompetitionsTabV2 gameState={stateWithFixtures(1, 1)} />);

    fireEvent.click(screen.getByRole("button", { name: /LEC/ }));

    expect(screen.getByText("1 team")).toBeInTheDocument();
    expect(screen.getByText("1 match")).toBeInTheDocument();
  });
});
