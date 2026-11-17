import { afterEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";
import {
  deriveTransferCollections,
  filterTransferPlayers,
  getCurrentTransferList,
  sortTransferPlayers,
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

  it("treats the linked real club as the user's side: its listed players are not on the market", () => {
    const linkedListed = createPlayer({
      id: "linked-listed",
      team_id: "les-alpha",
      transfer_listed: true,
      loan_listed: true,
      full_name: "Kid Linked",
      match_name: "Kid",
    });
    const rivalListed = createPlayer({
      id: "rival-listed",
      team_id: "team-2",
      transfer_listed: true,
      loan_listed: true,
      full_name: "Rival Pro",
      match_name: "Rival",
    });
    const gameState = createGameState([linkedListed, rivalListed]);
    gameState.teams[0] = createTeam({ id: "team-1", academy_team_id: "les-alpha" });
    gameState.teams.push(
      createTeam({
        id: "les-alpha",
        name: "Alpha Esports",
        team_kind: "Main",
        parent_team_id: "team-1",
        manager_id: null,
      }),
    );

    const collections = deriveTransferCollections(gameState, "team-1");

    expect(collections.marketPlayers.map((player) => player.id)).toEqual(["rival-listed"]);
    expect(collections.loanPlayers.map((player) => player.id)).toEqual(["rival-listed"]);
  });

  // Shaped like a free agent the active-pros pool adds: no team, an ISO-2 nationality, no contract.
  const poolFreeAgent = (overrides: Partial<PlayerData> = {}) =>
    createPlayer({
      id: "player-bea33543",
      full_name: "Rosendo Fuentes Boveda",
      match_name: "Send0o",
      nationality: "ES",
      natural_position: "TOP",
      position: "TOP",
      team_id: null,
      contract_end: null,
      wage: 0,
      market_value: 120000,
      transfer_listed: false,
      ...overrides,
    });

  it("lists a pool free agent with no team and no contract in the market", () => {
    const gameState = createGameState([poolFreeAgent()]);

    const collections = deriveTransferCollections(gameState, "team-1");

    expect(collections.marketPlayers.map((player) => player.id)).toEqual([
      "player-bea33543",
    ]);
  });

  describe("a free agent that shares a nick with a contracted player", () => {
    const marketIds = (...players: PlayerData[]) =>
      deriveTransferCollections(createGameState(players), "team-1").marketPlayers.map((p) => p.id);

    const contractedSend0o = (overrides: Partial<PlayerData> = {}) =>
      createPlayer({
        id: "contracted-send0o",
        match_name: "Send0o",
        full_name: "Rosendo Fuentes Boveda",
        date_of_birth: "2004-02-25",
        nationality: "ES",
        team_id: "team-2",
        ...overrides,
      });

    const freeSend0o = (overrides: Partial<PlayerData> = {}) =>
      poolFreeAgent({ date_of_birth: "2004-02-25", ...overrides });

    it("is hidden when nothing contradicts that they are the same person", () => {
      expect(marketIds(contractedSend0o(), freeSend0o())).toEqual([]);
    });

    it("stays visible when the date of birth differs", () => {
      expect(marketIds(contractedSend0o({ date_of_birth: "1999-07-01" }), freeSend0o())).toEqual([
        "player-bea33543",
      ]);
    });

    it("stays visible when the full name differs", () => {
      expect(marketIds(contractedSend0o({ full_name: "Another Person" }), freeSend0o())).toEqual([
        "player-bea33543",
      ]);
    });

    it("compares full names and nationalities ignoring case, accents and spaces", () => {
      const contracted = contractedSend0o({ full_name: "rosendo  fuentes boveda", nationality: "es" });
      const free = freeSend0o({ full_name: "Rosendo Fuéntes Boveda" });
      expect(marketIds(contracted, free)).toEqual([]);
    });

    it("stays visible when the nationalities differ", () => {
      const contracted = contractedSend0o({ full_name: "Send0o", date_of_birth: "", nationality: "FR" });
      expect(marketIds(contracted, freeSend0o())).toEqual(["player-bea33543"]);
    });

    it("hides the free agent behind a nick-only record with no other fields", () => {
      const nickOnly = contractedSend0o({ full_name: "Send0o", date_of_birth: "", nationality: "" });
      expect(marketIds(nickOnly, freeSend0o())).toEqual([]);
    });

    it("never lets a missing field on the free agent count as a difference", () => {
      const free = freeSend0o({ date_of_birth: "", nationality: "" });
      expect(marketIds(contractedSend0o(), free)).toEqual([]);
    });

    it("hides the free agent when any one contracted namesake could be them", () => {
      const other = contractedSend0o({ id: "other", full_name: "Someone Else" });
      expect(marketIds(other, contractedSend0o(), freeSend0o())).toEqual([]);
    });

    it("reads a 'Month D, YYYY' date of birth as the same day as its ISO form", () => {
      const stale = freeSend0o({ date_of_birth: "February 25, 2004" });
      expect(marketIds(contractedSend0o(), stale)).toEqual([]);
    });

    it("still tells apart two different days written in different forms", () => {
      const stale = freeSend0o({ date_of_birth: "February 26, 2004" });
      expect(marketIds(contractedSend0o(), stale)).toEqual(["player-bea33543"]);
    });

    it("counts an unreadable date of birth as unknown, not as different", () => {
      const stale = freeSend0o({ date_of_birth: "sometime in 2004" });
      expect(marketIds(contractedSend0o(), stale)).toEqual([]);
    });
  });

  it("sorts players without a date of birth after the rest by age, in both directions", () => {
    const players = [
      createPlayer({ id: "older", date_of_birth: "2000-01-01" }),
      createPlayer({ id: "unknown", date_of_birth: "" }),
      createPlayer({ id: "oldest", date_of_birth: "1995-05-05" }),
      createPlayer({ id: "youngest", date_of_birth: "January 19, 2006" }),
    ];

    const ids = (direction: "asc" | "desc") =>
      sortTransferPlayers(players, { key: "age", direction }, "2026-11-16").map((player) => player.id);

    expect(ids("asc")).toEqual(["youngest", "older", "oldest", "unknown"]);
    expect(ids("desc")).toEqual(["oldest", "older", "youngest", "unknown"]);
  });

  describe("age on the game date", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reads ages on the game date, not the computer's clock", () => {
      // Both are 21 on the game date, so they tie and keep their order. On the
      // computer's clock, months later, the first one is already 22.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2027-12-01T00:00:00Z"));
      const players = [
        createPlayer({ id: "born-june", date_of_birth: "2005-06-01" }),
        createPlayer({ id: "born-february", date_of_birth: "2006-02-15" }),
      ];

      const ids = sortTransferPlayers(players, { key: "age", direction: "asc" }, "2027-03-01")
        .map((player) => player.id);

      expect(ids).toEqual(["born-june", "born-february"]);
    });
  });
});
