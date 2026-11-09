import { describe, expect, it } from "vitest";

import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";
import {
  deriveTransferCollections,
  filterTransferPlayers,
  getCurrentTransferList,
  type TransferTabView,
} from "@/lib/transfers/model";

function createTeam(overrides: Partial<TeamData> = {}): TeamData {
  return {
    id: "team-1",
    name: "User FC",
    short_name: "USR",
    country: "England",
    city: "London",
    stadium_name: "User Ground",
    stadium_capacity: 25000,
    finance: 5000000,
    manager_id: "manager-1",
    reputation: 50,
    wage_budget: 50000,
    transfer_budget: 2000000,
    season_income: 0,
    season_expenses: 0,
    draft_strategy: "Balanced",
    training_focus: "Physical",
    training_intensity: "Medium",
    training_schedule: "Balanced",
    founded_year: 1900,
    colors: {
      primary: "#111111",
      secondary: "#ffffff",
    },
    facilities: {
      training: 1,
      medical: 1,
      scouting: 1,
    },
    starting_xi_ids: [],
    team_roles: {
      captain: null,
      shotcaller: null,
    },
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
    nationality: "England",
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
      handling: 30,
      reflexes: 30,
      aerial: 60,
    },
    condition: 90,
    morale: 70,
    team_id: "team-1",
    contract_end: "2028-06-30",
    wage: 1000,
    market_value: 1000000,
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

function createGameState(players: PlayerData[]): GameStateData {
  return {
    clock: {
      current_date: "2026-08-01T12:00:00Z",
      start_date: "2026-07-01T12:00:00Z",
    },
    manager: {
      id: "manager-1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "England",
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
      createTeam({ id: "team-2", manager_id: null, name: "Buyer FC" }),
    ],
    players,
    staff: [],
    messages: [],
    news: [],
    leagues: [{
      id: "league-1",
      name: "Premier Division",
      season: 1,
      fixtures: [],
      standings: [],
    }],
    scouting_assignments: [],
    board_objectives: [],
  };
}

describe("transfers/model", () => {
  it("derives the transfer collections for the current user team", () => {
    const userListed = createPlayer({
      id: "user-listed",
      transfer_listed: true,
    });
    const userLoanListed = createPlayer({
      id: "user-loan",
      loan_listed: true,
    });
    const marketPlayer = createPlayer({
      id: "market-player",
      team_id: "team-2",
      transfer_listed: true,
    });
    const releasedFreeAgent = createPlayer({
      id: "released-free-agent",
      full_name: "Released Agent",
      match_name: "R. Agent",
      date_of_birth: "1999-02-10",
      team_id: null,
      transfer_listed: false,
    });
    const loanPlayer = createPlayer({
      id: "loan-player",
      team_id: "team-2",
      loan_listed: true,
    });
    const offeredPlayer = createPlayer({
      id: "offered-player",
      transfer_offers: [
        {
          id: "offer-1",
          from_team_id: "team-1",
          fee: 1500000,
          wage_offered: 0,
          last_manager_fee: null,
          negotiation_round: 1,
          suggested_counter_fee: null,
          status: "Pending",
          date: "2026-08-01",
        },
      ],
    });
    const gameState = createGameState([
      userListed,
      userLoanListed,
      marketPlayer,
      releasedFreeAgent,
      loanPlayer,
      offeredPlayer,
    ]);

    const collections = deriveTransferCollections(gameState, "team-1");

    expect(collections.myTransferList.map((player) => player.id)).toEqual([
      "user-listed",
    ]);
    expect(collections.myLoanList.map((player) => player.id)).toEqual([
      "user-loan",
    ]);
    expect(collections.marketPlayers.map((player) => player.id)).toEqual([
      "market-player",
      "released-free-agent",
    ]);
    expect(collections.loanPlayers.map((player) => player.id)).toEqual([
      "loan-player",
    ]);
    expect(collections.playersWithOffers.map((player) => player.id)).toEqual([
      "offered-player",
    ]);
  });

  it("returns the current list for the selected view", () => {
    const collections = {
      myTransferList: [createPlayer({ id: "transfer" })],
      myLoanList: [createPlayer({ id: "loan" })],
      marketPlayers: [createPlayer({ id: "market" })],
      loanPlayers: [createPlayer({ id: "loan-market" })],
      playersWithOffers: [createPlayer({ id: "offers" })],
    };

    const getIds = (view: TransferTabView) =>
      getCurrentTransferList(view, collections).map((player) => player.id);

    expect(getIds("my_list")).toEqual(["transfer", "loan"]);
    expect(getIds("market")).toEqual(["market"]);
    expect(getIds("loans")).toEqual(["loan-market"]);
    expect(getIds("offers")).toEqual(["offers"]);
  });

  it("filters by LoL role and search text", () => {
    const players = [
      createPlayer({
        id: "goalkeeper",
        full_name: "Alan Keeper",
        match_name: "Keeper",
        nationality: "Spain",
        natural_position: "Goalkeeper",
        position: "Goalkeeper",
      }),
      createPlayer({
        id: "forward",
        full_name: "Carlos Striker",
        match_name: "Carx",
        nationality: "Brazil",
        natural_position: "Forward",
        position: "Forward",
      }),
    ];

    expect(filterTransferPlayers(players, "", "SUPPORT", null)).toHaveLength(1);
    expect(filterTransferPlayers(players, "bra", null, null).map((player) => player.id)).toEqual([
      "forward",
    ]);
    expect(filterTransferPlayers(players, "carx", "ADC", null).map((player) => player.id)).toEqual([
      "forward",
    ]);
  });

  it("excludes duplicated identities when academy owns the player", () => {
    const mainDuplicate = createPlayer({
      id: "market-main",
      team_id: "team-2",
      transfer_listed: true,
      full_name: "Karmine Fenix",
      match_name: "Fenix",
      date_of_birth: "2005-03-11",
      nationality: "France",
    });
    const academyDuplicate = createPlayer({
      id: "market-academy",
      team_id: "academy-1",
      transfer_listed: true,
      full_name: "Karmine Fénix",
      match_name: "Fénix",
      date_of_birth: "2005-03-11",
      nationality: "France",
    });
    const gameState = createGameState([
      mainDuplicate,
      academyDuplicate,
    ]);
    gameState.teams.push(
      createTeam({
        id: "academy-1",
        name: "Academy Team",
        team_kind: "Academy",
        manager_id: null,
      }),
    );

    const collections = deriveTransferCollections(gameState, "team-1");

    expect(collections.marketPlayers).toHaveLength(0);
  });

  it("excludes transfer-listed players when same identity exists in academy", () => {
    const duplicatedInAcademy = createPlayer({
      id: "market-main-copy",
      team_id: "team-2",
      transfer_listed: true,
      full_name: "Prospect One",
      match_name: "P1",
      date_of_birth: "2006-06-20",
      nationality: "Spain",
    });
    const academyCanonical = createPlayer({
      id: "academy-prospect",
      team_id: "academy-1",
      transfer_listed: false,
      full_name: "Prospect One",
      match_name: "P1",
      date_of_birth: "2006-06-20",
      nationality: "Spain",
    });
    const unrelatedMarketPlayer = createPlayer({
      id: "market-keep",
      team_id: "team-2",
      transfer_listed: true,
      full_name: "Unrelated",
      match_name: "Unrelated",
      date_of_birth: "2001-01-01",
      nationality: "France",
    });
    const gameState = createGameState([
      duplicatedInAcademy,
      academyCanonical,
      unrelatedMarketPlayer,
    ]);
    gameState.teams.push(
      createTeam({
        id: "academy-1",
        name: "Academy Team",
        team_kind: "Academy",
        manager_id: null,
      }),
    );

    const collections = deriveTransferCollections(gameState, "team-1");

    expect(collections.marketPlayers.map((player) => player.id)).toEqual([
      "market-keep",
    ]);
  });
});
