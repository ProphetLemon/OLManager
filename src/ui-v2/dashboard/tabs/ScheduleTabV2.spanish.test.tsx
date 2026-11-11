import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { ScheduleTabV2 } from "./ScheduleTabV2";

function fixture(id: string, date: string, matchday: number, matchType: string) {
  return {
    id,
    matchday,
    date,
    home_team_id: "t1",
    away_team_id: "t2",
    competition: "League",
    match_type: matchType,
    best_of: 1,
    status: "Scheduled",
    result: null,
  };
}

const gameState = {
  clock: { current_date: "2027-01-01T12:00:00Z" },
  manager: { team_id: "t1" },
  teams: [
    { id: "t1", name: "Alpha", short_name: "ALP", logo_url: null },
    { id: "t2", name: "Beta", short_name: "BET", logo_url: null },
  ],
  user_competition_id: "lec",
  leagues: [
    {
      id: "lg1",
      competition_id: "lec",
      name: "LEC",
      standings: [],
      fixtures: [
        fixture("f1", "2027-01-04", 0, "Friendly"),
        fixture("f2", "2027-02-08", 4, "League"),
      ],
    },
  ],
} as unknown as GameStateData;

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ScheduleTabV2 in the Spanish UI", () => {
  it("writes the match dates with the app language, not English", () => {
    render(<ScheduleTabV2 gameState={gameState} onSelectTeam={() => {}} />);

    expect(screen.getByText(/Jornada 4 — lun, 8 feb/i)).toBeInTheDocument();
    expect(screen.getByText(/Amistoso — lun, 4 ene/i)).toBeInTheDocument();
    expect(screen.queryByText(/\b(Mon|Jan)\b/i)).toBeNull();
  });

  it("translates the heading of the week card", () => {
    render(<ScheduleTabV2 gameState={gameState} onSelectTeam={() => {}} />);

    expect(screen.getByText("Esta semana")).toBeInTheDocument();
    expect(screen.queryByText(/this week/i)).toBeNull();
  });
});
