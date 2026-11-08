import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FixtureData, LeagueData, TeamData } from "@/store/gameStore";
import PlayoffBracketBoard from "./PlayoffBracketBoard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const FOUR_TEAM_PREFIX = "po4-";

function fixture(id: string, matchday: number, home: string, away: string): FixtureData {
  return {
    id,
    matchday,
    date: "2026-03-01",
    home_team_id: home,
    away_team_id: away,
    match_type: "Playoffs",
    best_of: 5,
    status: "Scheduled",
    result: null,
  };
}

function league(name: string, fixtures: FixtureData[]): LeagueData {
  return { id: "les", name, season: 2026, fixtures, standings: [] };
}

const teams = ["a", "b", "c", "d"].map((id) => ({ id, name: `Team ${id}` })) as TeamData[];

const semifinalsOnly = [
  fixture(`${FOUR_TEAM_PREFIX}1`, 29, "a", "d"),
  fixture(`${FOUR_TEAM_PREFIX}2`, 29, "b", "c"),
];

const fullBracket = [...semifinalsOnly, fixture(`${FOUR_TEAM_PREFIX}3`, 30, "a", "b")];

describe("PlayoffBracketBoard four-team bracket", () => {
  it("labels the first round as semifinals even when the league name says spring", () => {
    render(<PlayoffBracketBoard league={league("LES Spring", semifinalsOnly)} teams={teams} />);
    expect(screen.getByText("tournaments.playoffSemifinals")).toBeTruthy();
  });

  it("labels the last round as the final", () => {
    render(<PlayoffBracketBoard league={league("LES Summer", fullBracket)} teams={teams} />);
    expect(screen.getByText("tournaments.playoffFinal")).toBeTruthy();
  });

  it("renders a single lane with no lower bracket", () => {
    render(<PlayoffBracketBoard league={league("LES Winter", fullBracket)} teams={teams} />);
    expect(screen.queryByText("tournaments.lowerBracket")).toBeNull();
  });

  it("names the lane as single elimination instead of the upper bracket", () => {
    render(<PlayoffBracketBoard league={league("LES Winter", fullBracket)} teams={teams} />);
    expect(screen.getByText("tournaments.singleEliminationBracket")).toBeTruthy();
  });
});

describe("PlayoffBracketBoard double-elimination bracket", () => {
  it("keeps the upper bracket lane for unmarked fixtures", () => {
    const lec = [fixture("uuid-1", 29, "a", "d"), fixture("uuid-2", 29, "b", "c")];
    render(<PlayoffBracketBoard league={league("LEC Spring", lec)} teams={teams} />);
    expect(screen.getByText("tournaments.upperBracket")).toBeTruthy();
  });

  it("keeps the LEC round labels for unmarked fixtures", () => {
    const lec = [fixture("uuid-1", 29, "a", "d"), fixture("uuid-2", 29, "b", "c")];
    render(<PlayoffBracketBoard league={league("LEC Spring", lec)} teams={teams} />);
    expect(screen.getByText("UPPER R1")).toBeTruthy();
  });
});
