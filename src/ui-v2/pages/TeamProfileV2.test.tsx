import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";
import TeamProfileV2 from "@/ui-v2/pages/TeamProfileV2";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.back": "Back",
        "teams.avgOvr": "Avg OVR",
        "teams.rep": "Rep",
        "teams.squad": "Squad",
        "teams.est": "Est.",
        "manager.reputation": "Reputation",
        "teamProfile.leaguePos": "League Pos",
        "teamProfile.managerLabel": "Manager:",
        "teamProfile.clubInfo": "Club Information",
        "teamProfile.hq": "HQ",
        "teamProfile.erl": "ERL",
        "teamProfile.activeRoster": "Active roster",
        "teamProfile.roleSetup": "Core roles",
        "teamProfile.draftIdentity": "Draft identity",
        "teamProfile.draftStrategyBalanced": "Balanced",
        "dashboard.finances": "Finances",
        "teamProfile.balance": "Balance",
        "teamProfile.totalWages": "Total Wages",
        "teamProfile.squadOverview": "Squad Overview",
        "teamProfile.squadSize": "Squad Size",
        "teamProfile.leagueStanding": "League Standing",
        "teamProfile.winRate": "WR",
        "teamProfile.matchesPlayed": "Matches",
        "teamProfile.wins": "Wins",
        "teamProfile.losses": "Losses",
        "teamProfile.kills": "Kills",
        "teamProfile.deaths": "Deaths",
        "teamProfile.goldEarned": "Gold Earned",
        "teamProfile.damageToChampions": "Damage To Champions",
        "teamProfile.objectives": "Objectives",
        "teamProfile.averageGameDuration": "Average Game Duration",
        "teamProfile.perMatch": "Per Match",
        "teamProfile.killsDeathsObjectives": "K / D / Obj.",
        "teamProfile.economy": "Gold / Objectives",
        "teamProfile.side": "Side",
        "match.draft.sides.blue": "Blue side",
        "match.draft.sides.red": "Red side",
        "match.victory": "Victory",
        "match.defeat": "Defeat",
        "finances.wageBudget": "Wage Budget",
        "finances.transferBudget": "Transfer Budget",
        "finances.squadValue": "Squad Value",
        "finances.seasonIncome": "Season Income",
        "finances.perWeekSuffix": "/wk",
        "tactics.draftStrategy": "Draft Strategy",
        "common.per_year_with_slash": "/yr",
        "common.played": "P",
        "common.won": "W",
        "common.drawn": "D",
        "common.lost": "L",
        "common.pts": "Pts",
        "common.position": "Pos",
        "common.name": "Name",
        "common.age": "Age",
        "common.nationality": "Nationality",
        "common.value": "Value",
        "common.ovr": "OVR",
      };

      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
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
    season_income: 100000,
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

function createPlayer(overrides: Partial<PlayerData> = {}): PlayerData {
  return {
    id: "player-1",
    match_name: "J. Smith",
    full_name: "John Smith",
    date_of_birth: "2000-01-01",
    nationality: "GB",
    position: "Forward",
    natural_position: "Forward",
    alternate_positions: [],
    training_focus: null,
    attributes: {
      pace: 60,
      stamina: 60,
      strength: 60,
      agility: 60,
      passing: 60,
      shooting: 60,
      tackling: 60,
      dribbling: 60,
      defending: 60,
      positioning: 60,
      vision: 60,
      decisions: 60,
      composure: 60,
      aggression: 60,
      teamwork: 60,
      leadership: 60,
      handling: 20,
      reflexes: 20,
      aerial: 60,
    },
    condition: 80,
    morale: 75,
    team_id: "team-1",
    contract_end: null,
    wage: 12000,
    market_value: 350000,
    stats: {
      appearances: 0,
      goals: 0,
      assists: 0,
      clean_sheets: 0,
      yellow_cards: 0,
      red_cards: 0,
      avg_rating: 0,
      minutes_played: 0,
    },
    career: [],
    transfer_listed: false,
    loan_listed: false,
    transfer_offers: [],
    traits: [],
    ...overrides,
  };
}

function createGameState(team: TeamData): GameStateData {
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
      team_id: team.id,
      career_stats: {
        matches_managed: 0,
        wins: 0,
        losses: 0,
        trophies: 0,
        best_finish: null,
      },
      career_history: [],
    },
    teams: [team],
    players: [createPlayer()],
    staff: [],
    messages: [],
    news: [],
    leagues: [{
      id: "league-1",
      name: "League",
      season: 1,
      fixtures: [],
      standings: [
        {
          team_id: team.id,
          played: 2,
          won: 1,
          lost: 0,
          maps_won: 5,
          maps_lost: 1,
          points: 4,
        },
      ],
    }],
    scouting_assignments: [],
    board_objectives: [],
  };
}

describe("TeamProfileV2", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("loads and renders team stats overview from the backend", async () => {
    const team = createTeam();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "get_team_stats_overview") {
        return {
          matchesPlayed: 12,
          wins: 8,
          losses: 3,
          metrics: {
            kills: { total: 160, perMatch: 13.3 },
            deaths: { total: 68, perMatch: 5.7 },
            goldEarned: { total: 5400, perMatch: 450 },
            damageToChampions: { total: 6300, perMatch: 525 },
            objectives: { total: 48, perMatch: 4 },
            averageGameDurationSeconds: { total: 25200, perMatch: 2100 },
          },
        };
      }

      return null;
    });

    render(
      <TeamProfileV2
        teamId={team.id}
        gameState={createGameState(team)}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_team_stats_overview", {
        teamId: "team-1",
      });
    });
  });

  it("loads and renders recent team match history from the backend", async () => {
    const team = createTeam();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "get_team_match_history") {
        return [
          {
            fixtureId: "fixture-2",
            date: "2026-08-01",
            match_type: "League",
            matchday: 1,
            opponentTeamId: "team-2",
            opponentName: "Bravo FC",
            side: "Red",
            result: "Loss",
            gameDurationSeconds: 2100,
            kills: 16,
            deaths: 7,
            goldEarned: 62000,
            damageToChampions: 88000,
            objectives: 3,
          },
        ];
      }

      if (command === "get_team_stats_overview") {
        return null;
      }

      return null;
    });

    render(
      <TeamProfileV2
        teamId={team.id}
        gameState={createGameState(team)}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_team_match_history", {
        teamId: "team-1",
        limit: 5,
      });
      expect(screen.getByText("Bravo FC")).toBeInTheDocument();
      expect(screen.getByText("Red side · Defeat")).toBeInTheDocument();
      expect(screen.getByText("16 / 7 / 3")).toBeInTheDocument();
      expect(screen.getByText("62000 / 88000")).toBeInTheDocument();
    });
  });

  it("uses academy logo URL in profile hero when available", async () => {
    const team = createTeam({
      id: "academy-1",
      name: "Movistar KOI Fenix",
      short_name: "MKF",
      team_kind: "Academy",
      academy: {
        lifecycle: "Active",
        erl_assignment: {
          erl_league_id: "erl-spain",
          country_rule: "Domestic",
          fallback_reason: null,
          reputation: 60,
          creation_cost: 0,
          created_at: "2026-08-10T00:00:00Z",
        },
        branding: {
          current_name: "Movistar KOI Fenix",
          current_short_name: "MKF",
          current_logo_url:
            "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/b/b0/Falke_Esportslogo_square.png/revision/latest/scale-to-width-down/220?cb=20250917172449",
        },
      },
    });

    render(
      <TeamProfileV2
        teamId={team.id}
        gameState={createGameState(team)}
        onClose={vi.fn()}
      />,
    );

    const logo = await screen.findByAltText("Movistar KOI Fenix logo");
    expect(logo).toHaveAttribute(
      "src",
      "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/b/b0/Falke_Esportslogo_square.png/revision/latest/scale-to-width-down/220?cb=20250917172449",
    );
  });

  it("resolves academy logo from data/erls team list when metadata logo is missing", async () => {
    const team = createTeam({
      id: "academy-liga-espanola-movistar-koi-fenix",
      name: "Movistar KOI Fénix",
      short_name: "MKF",
      team_kind: "Academy",
      academy: {
        lifecycle: "Active",
        erl_assignment: {
          erl_league_id: "liga-espanola",
          country_rule: "Domestic",
          fallback_reason: null,
          reputation: 60,
          creation_cost: 0,
          created_at: "2026-08-10T00:00:00Z",
        },
      },
    });

    render(
      <TeamProfileV2
        teamId={team.id}
        gameState={createGameState(team)}
        onClose={vi.fn()}
      />,
    );

    const logo = await screen.findByAltText("Movistar KOI Fénix logo");
    expect(logo.getAttribute("src")).toBe("/teams-icons/movistarkoifenix.webp");
  });

  it("shows the founding year in the hero only when it is known", () => {
    const { rerender } = render(
      <TeamProfileV2 teamId="team-1" gameState={createGameState(createTeam({ founded_year: 1998 }))} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/Est\. 1998/)).toBeInTheDocument();

    rerender(
      <TeamProfileV2 teamId="team-1" gameState={createGameState(createTeam({ founded_year: 0 }))} onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/Est\./)).not.toBeInTheDocument();
  });

  it("shows ERL league in club details only for academy teams", async () => {
    const academyTeam = createTeam({
      id: "academy-lfl-solary",
      name: "Solary Academy",
      short_name: "SLYA",
      team_kind: "Academy",
      academy: {
        lifecycle: "Active",
        erl_assignment: {
          erl_league_id: "lfl",
          country_rule: "Domestic",
          fallback_reason: null,
          reputation: 60,
          creation_cost: 0,
          created_at: "2026-08-10T00:00:00Z",
        },
      },
    });

    render(
      <TeamProfileV2
        teamId={academyTeam.id}
        gameState={createGameState(academyTeam)}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("ERL")).toBeInTheDocument();
    expect(screen.getByText("LFL")).toBeInTheDocument();
    expect(screen.queryByText("London")).not.toBeInTheDocument();
  });

  it("goes back and opens a player from the roster", () => {
    const team = createTeam();
    const onClose = vi.fn();
    const onSelectPlayer = vi.fn();

    render(
      <TeamProfileV2
        teamId={team.id}
        gameState={createGameState(team)}
        onClose={onClose}
        onSelectPlayer={onSelectPlayer}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("J. Smith"));
    expect(onSelectPlayer).toHaveBeenCalledWith("player-1");
  });

  it("shows finances and the condition column only for the managed team", () => {
    const team = createTeam();
    const own = render(
      <TeamProfileV2 teamId={team.id} gameState={createGameState(team)} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Finances")).toBeInTheDocument();
    expect(screen.getByText("common.condition")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
    own.unmount();

    const state = createGameState(team);
    state.manager.team_id = "other-team";
    render(<TeamProfileV2 teamId={team.id} gameState={state} onClose={vi.fn()} />);
    expect(screen.getByText("Squad Overview")).toBeInTheDocument();
    expect(screen.queryByText("Finances")).not.toBeInTheDocument();
    expect(screen.queryByText("common.condition")).not.toBeInTheDocument();
  });

  it("translates the per-year suffix of the wage rows", () => {
    const team = createTeam();
    render(<TeamProfileV2 teamId={team.id} gameState={createGameState(team)} onClose={vi.fn()} />);
    const perYear = screen.getAllByText(/\/yr$/);
    expect(perYear).toHaveLength(2);
    expect(screen.queryByText(/\/año/)).not.toBeInTheDocument();
  });

  it("renders nothing for an unknown team", () => {
    const team = createTeam();
    const { container } = render(
      <TeamProfileV2 teamId="missing" gameState={createGameState(team)} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
