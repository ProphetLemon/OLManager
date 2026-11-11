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
