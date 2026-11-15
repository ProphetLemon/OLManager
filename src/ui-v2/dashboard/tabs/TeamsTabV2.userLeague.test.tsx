import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { TeamsTabV2 } from "./TeamsTabV2";

const standing = (team_id: string, won: number, lost: number) => ({
  team_id,
  played: won + lost,
  won,
  lost,
  maps_won: won * 2,
  maps_lost: lost * 2,
  points: won * 3,
});

// The user plays in the second league of the list ("les"); the first one is "lec".
function buildState(): GameStateData {
  return {
    manager: { team_id: "t1" },
    user_competition_id: "les",
    leagues: [
      { id: "lec-league", competition_id: "lec", name: "LEC", season: 1, fixtures: [], standings: [standing("t1", 0, 5)] },
      { id: "les-league", competition_id: "les", name: "LES", season: 1, fixtures: [], standings: [standing("t1", 3, 0)] },
    ],
    teams: [{ id: "t1", name: "Alpha", short_name: "ALP", competition_id: "les", colors: { primary: "#111", secondary: "#eee" } }],
    players: [],
  } as unknown as GameStateData;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("TeamsTabV2 standings", () => {
  it("shows the record from the user's league, not from the first league", () => {
    render(<TeamsTabV2 gameState={buildState()} onSelectTeam={() => {}} />);

    expect(screen.getByText(/3W 0L/)).toBeTruthy();
    expect(screen.queryByText(/0W 5L/)).toBeNull();
  });
});

describe("TeamsTabV2 founding year", () => {
  const withFounded = (founded_year: number): GameStateData => {
    const state = buildState();
    (state.teams[0] as unknown as { founded_year: number }).founded_year = founded_year;
    return state;
  };

  it("shows the founding year when it is known", () => {
    render(<TeamsTabV2 gameState={withFounded(2012)} onSelectTeam={() => {}} />);

    expect(screen.getByText(/2012/)).toBeTruthy();
  });

  it("hides the founding year when it is 0", () => {
    render(<TeamsTabV2 gameState={withFounded(0)} onSelectTeam={() => {}} />);

    expect(screen.queryByText(new RegExp(`${i18n.t("teams.est")} 0`))).toBeNull();
  });
});

describe("TeamsTabV2 clubs of other leagues", () => {
  it("shows the record and position of a club from its own league's standings", () => {
    const state = buildState();
    state.leagues.push({
      id: "lck-league", competition_id: "lck", name: "LCK", season: 1, fixtures: [],
      standings: [standing("t9", 1, 4), standing("t8", 4, 1)],
    } as never);
    state.teams.push({
      id: "t8", name: "Bravo", short_name: "BRA", competition_id: "lck", colors: { primary: "#111", secondary: "#eee" },
    } as never);

    render(<TeamsTabV2 gameState={state} onSelectTeam={() => {}} />);

    expect(screen.getByText(/4W 1L/)).toBeTruthy();
    // Bravo leads its league: shown as position 1 (the user's club also shows 1 in its own league).
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2);
  });
});
