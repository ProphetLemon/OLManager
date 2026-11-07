import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FixtureData, GameStateData, TeamData } from "@/store/gameStore";
import ScheduleTab from "@/ui-v2/_legacy/components/schedule/ScheduleTab";

vi.mock("../../lib/season/seasonContext", () => ({
  resolveSeasonContext: () => ({
    phase: "RegularSeason",
    season_start: "2026-08-01",
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "schedule.noLeague") return "No league";
      if (key === "schedule.matches") return "Fixtures";
      if (key === "schedule.standings") return "Standings";
      if (key === "common.team") return "Team";
      if (key === "common.played") return "P";
      if (key === "common.won") return "W";
      if (key === "common.drawn") return "D";
      if (key === "common.lost") return "L";
      if (key === "common.pts") return "Pts";
      if (key === "schedule.season") return `Season ${params?.number}`;
      if (key === "schedule.matchday") return `Matchday ${params?.number}`;
      if (key === "schedule.viewResult") return "View result";
      return key;
    },
  }),
}));

vi.mock("../match/DraftResultScreen", () => ({
  default: ({ seriesGames }: { seriesGames?: Array<{ gameIndex: number }> }) => (
    <div data-testid="draft-result-series-games">{seriesGames?.length ?? 0}</div>
  ),
}));

function createTeam(overrides: Partial<TeamData> = {}): TeamData {
  return {
    id: "team-1",
    name: "Alpha FC",
    short_name: "ALP",
    country: "GB",
    city: "London",
    stadium_name: "Alpha Ground",
    stadium_capacity: 30000,
    finance: 500000,
    manager_id: "manager-1",
    reputation: 50,
    wage_budget: 50000,
    transfer_budget: 250000,
    season_income: 0,
    season_expenses: 0,
    draft_strategy: "Balanced",
    training_focus: "General",
    training_intensity: "Balanced",
    training_schedule: "Balanced",
    founded_year: 1900,
    colors: { primary: "#000000", secondary: "#ffffff" },
    starting_xi_ids: [],
    form: [],
    history: [],
    ...overrides,
  };
}

function createFixture(overrides: Partial<FixtureData> = {}): FixtureData {
  return {
    id: "fixture-1",
    matchday: 1,
    date: "2026-08-01",
    home_team_id: "team-1",
    away_team_id: "team-2",
    match_type: "League",
    status: "Completed",
    result: {
      home_goals: 2,
      away_goals: 1,
      home_scorers: [],
      away_scorers: [],
    },
    ...overrides,
  };
}

function createGameState(withLeague: boolean): GameStateData {
  return {
    clock: {
      current_date: "2026-08-10T00:00:00Z",
      start_date: "2026-07-01T00:00:00Z",
    },
    manager: {
      id: "manager-1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "GB",
      reputation: 50,
      satisfaction: 50,
      fan_approval: 50,
      team_id: "team-1",
      career_stats: {
        matches_managed: 0,
        wins: 0,
        losses: 0,
        trophies: 0,
        best_finish: null,
      },
      career_history: [],
    },
    teams: [
      createTeam(),
      createTeam({ id: "team-2", name: "Beta FC", short_name: "BET" }),
    ],
    players: [],
    staff: [],
    messages: [],
    news: [],
    leagues: withLeague
      ? [{
          id: "league-1",
          name: "Premier League",
          season: 1,
          fixtures: [createFixture()],
          standings: [
            {
              team_id: "team-1",
              played: 1,
              won: 1,
          lost: 0,
          maps_won: 2,
          maps_lost: 1,
              points: 3,
            },
            {
              team_id: "team-2",
              played: 1,
              won: 0,
          lost: 1,
          maps_won: 1,
          maps_lost: 2,
              points: 0,
            },
          ],
        }]
      : [],
    scouting_assignments: [],
    board_objectives: [],
  };
}

describe("ScheduleTab", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the empty state when there is no league", () => {
    render(<ScheduleTab gameState={createGameState(false)} onSelectTeam={vi.fn()} />);

    expect(screen.getByText("No league")).toBeInTheDocument();
  });

  // NOTE: the standings view (and its in-table team selection) was removed from
  // ScheduleTab — see "Sorted standings — removed (tab deleted)" in the source.
  // The former "switches to standings and lets the user select a team" test was
  // dropped because it exercised that deleted functionality.

  it("renders playoff series score from home_wins and away_wins", () => {
    const playoffFixture = createFixture({
      match_type: "Playoffs",
      matchday: 12,
      result: {
        home_wins: 2,
        away_wins: 1,
      },
    });

    render(
      <ScheduleTab
        gameState={{
          ...createGameState(true),
          leagues: [{
            ...createGameState(true).leagues[0]!,
            fixtures: [playoffFixture],
          }],
        }}
        onSelectTeam={vi.fn()}
      />,
    );

    expect(screen.getAllByText("2 - 1").length).toBeGreaterThan(0);
  });

  it("uses stored fixture series wins when available", () => {
    const playoffFixture = createFixture({
      id: "fixture-playoff-1",
      match_type: "Playoffs",
      matchday: 12,
      result: {
        home_goals: 0,
        away_goals: 0,
      },
    });

    localStorage.setItem(
      "fixture-draft-result:fixture-playoff-1",
      JSON.stringify({
        snapshot: {
          home_team: { id: "team-1", name: "Alpha FC", players: [] },
          away_team: { id: "team-2", name: "Beta FC", players: [] },
        },
        controlledSide: "blue",
        result: { winnerSide: "blue" },
        homeSeriesWins: 2,
        awaySeriesWins: 1,
      }),
    );

    render(
      <ScheduleTab
        gameState={{
          ...createGameState(true),
          leagues: [{
            ...createGameState(true).leagues[0]!,
            fixtures: [playoffFixture],
          }],
        }}
        onSelectTeam={vi.fn()}
      />,
    );

    expect(screen.getByText("2 - 1")).toBeInTheDocument();
  });

  it("applies Bo3 to first playoff round and Bo5 to second", () => {
    const playoffRoundOne = createFixture({
      id: "playoff-r1",
      match_type: "Playoffs",
      matchday: 10,
      status: "Scheduled",
      result: undefined,
    });
    const playoffRoundTwo = createFixture({
      id: "playoff-r2",
      match_type: "Playoffs",
      matchday: 11,
      date: "2026-08-08",
      status: "Scheduled",
      result: undefined,
    });

    render(
      <ScheduleTab
        gameState={{
          ...createGameState(true),
          leagues: [{
            ...createGameState(true).leagues[0]!,
            fixtures: [playoffRoundOne, playoffRoundTwo],
          }],
        }}
        onSelectTeam={vi.fn()}
      />,
    );

    expect(screen.getAllByText("BO3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("BO5").length).toBeGreaterThan(0);
  });

  it("shows Bo3 and Bo5 on the first two preseason friendlies", () => {
    const friendlyOne = createFixture({
      id: "friendly-1",
      match_type: "Friendly",
      matchday: 0,
      date: "2026-01-04",
      status: "Scheduled",
      result: undefined,
    });
    const friendlyTwo = createFixture({
      id: "friendly-2",
      match_type: "Friendly",
      matchday: 0,
      date: "2026-01-11",
      status: "Scheduled",
      result: undefined,
    });

    render(
      <ScheduleTab
        gameState={{
          ...createGameState(true),
          leagues: [{
            ...createGameState(true).leagues[0]!,
            fixtures: [friendlyOne, friendlyTwo],
          }],
        }}
        onSelectTeam={vi.fn()}
      />,
    );

    expect(screen.getAllByText("BO3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("BO5").length).toBeGreaterThan(0);
  });

  it("passes stored series games to calendar draft result view", () => {
    const playoffFixture = createFixture({
      id: "fixture-playoff-1",
      match_type: "Playoffs",
      matchday: 12,
    });

    localStorage.setItem(
      "fixture-draft-result:fixture-playoff-1",
      JSON.stringify({
        snapshot: {
          home_team: { id: "team-1", name: "Alpha FC", players: [] },
          away_team: { id: "team-2", name: "Beta FC", players: [] },
        },
        controlledSide: "blue",
        result: { winnerSide: "blue" },
        seriesGames: [
          { gameIndex: 1, result: { winnerSide: "blue" }, winnerSide: "blue" },
          { gameIndex: 2, result: { winnerSide: "red" }, winnerSide: "red" },
        ],
      }),
    );

    render(
      <ScheduleTab
        gameState={{
          ...createGameState(true),
          leagues: [{
            ...createGameState(true).leagues[0]!,
            fixtures: [playoffFixture],
          }],
        }}
        onSelectTeam={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("View result"));

    expect(screen.getByTestId("draft-result-series-games")).toHaveTextContent("2");
  });
});

