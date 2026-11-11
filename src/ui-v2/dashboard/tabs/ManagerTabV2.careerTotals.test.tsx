import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { ManagerTabV2 } from "./ManagerTabV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function buildState(careerStats: { matches_managed: number; wins: number; losses: number }): GameStateData {
  return {
    clock: { current_date: "2026-04-29T00:00:00Z", start_date: "2026-04-01T00:00:00Z" },
    manager: {
      id: "m1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "ES",
      team_id: "t1",
      career_stats: { ...careerStats, draws: 0, trophies: 0, best_finish: null },
      career_history: [],
    },
    user_competition_id: "les",
    leagues: [
      {
        id: "les-league",
        competition_id: "les",
        name: "LES",
        season: 1,
        fixtures: [],
        standings: [
          { team_id: "t1", played: 5, won: 3, lost: 2, maps_won: 6, maps_lost: 4, points: 9 },
          { team_id: "t2", played: 5, won: 2, lost: 3, maps_won: 4, maps_lost: 6, points: 6 },
        ],
      },
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

describe("ManagerTabV2 career totals", () => {
  it("adds the running season of the user's club to the totals saved at season end", () => {
    render(<ManagerTabV2 gameState={buildState({ matches_managed: 20, wins: 12, losses: 8 })} />);

    expect(screen.getByText("25")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
  });

  it("labels the losses tile as losses, not as matches played", () => {
    render(<ManagerTabV2 gameState={buildState({ matches_managed: 20, wins: 12, losses: 8 })} />);

    expect(screen.getByText("10").nextElementSibling?.textContent).toBe("Losses");
  });

  it("shows the matches played so far in a first season, before any total is saved", () => {
    render(<ManagerTabV2 gameState={buildState({ matches_managed: 0, wins: 0, losses: 0 })} />);

    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
  });
});
