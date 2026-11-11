import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { ManagerTabV2 } from "./ManagerTabV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const standing = (team_id: string, points: number) => ({
  team_id,
  played: 1,
  won: 1,
  lost: 0,
  maps_won: 2,
  maps_lost: 0,
  points,
});

// The user plays in the second league ("les"). Alpha is 1st there but 2nd in the first league.
function buildState(): GameStateData {
  return {
    clock: { current_date: "2026-04-29T00:00:00Z", start_date: "2026-04-01T00:00:00Z" },
    manager: {
      id: "m1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "ES",
      team_id: "t1",
      career_stats: { matches_managed: 0, wins: 0, draws: 0, losses: 0, trophies: 0, best_finish: null },
      career_history: [],
    },
    user_competition_id: "les",
    leagues: [
      { id: "lec-league", competition_id: "lec", name: "LEC", season: 1, fixtures: [], standings: [standing("t9", 9), standing("t1", 3), standing("t8", 1), standing("t7", 0)] },
      { id: "les-league", competition_id: "les", name: "LES", season: 1, fixtures: [], standings: [standing("t1", 6), standing("t2", 3)] },
    ],
    teams: [{ id: "t1", name: "Alpha", short_name: "ALP", competition_id: "les", colors: { primary: "#111", secondary: "#eee" } }],
    players: [],
    staff: [],
    messages: [],
    news: [],
  } as unknown as GameStateData;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ManagerTabV2 league", () => {
  it("shows the position and team count of the user's league, not the first league", () => {
    render(<ManagerTabV2 gameState={buildState()} />);

    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText(/· 2 /)).toBeTruthy();
    expect(screen.queryByText("#2")).toBeNull();
  });
});
