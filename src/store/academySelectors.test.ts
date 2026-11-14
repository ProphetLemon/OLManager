import { describe, expect, it } from "vitest";

import {
  findAcademyTeamForParent,
  getMainTeams,
  getManagedTeamIds,
  getTeamAcademyRoster,
  isAcademyTeam,
  isLinkedAcademyClub,
  isUserAcademyClub,
} from "./academySelectors";
import type { PlayerData, TeamData } from "./types";

function team(overrides: Partial<TeamData>): TeamData {
  return {
    id: "team-1",
    name: "Alpha FC",
    short_name: "ALP",
    country: "GB",
    city: "London",
    stadium_name: "Alpha Ground",
    stadium_capacity: 30000,
    finance: 500000,
    manager_id: null,
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
    colors: { primary: "#000", secondary: "#fff" },
    starting_xi_ids: [],
    form: [],
    history: [],
    ...overrides,
  };
}

function player(overrides: Partial<PlayerData>): PlayerData {
  return {
    id: "player-1",
    match_name: "Rookie",
    full_name: "Rookie One",
    date_of_birth: "2008-01-01",
    nationality: "GB",
    position: "MID",
    natural_position: "MID",
    alternate_positions: [],
    training_focus: null,
    attributes: {
      stamina: 50,
      durability: 50,
      agility: 50,
      coordination: 50,
      shooting: 50,
      interception: 50,
      dribbling: 50,
      positional_defense: 50,
      positioning: 50,
      vision: 50,
      decisions: 50,
      composure: 50,
      aggression: 50,
      teamwork: 50,
      leadership: 50,
    },
    condition: 80,
    morale: 80,
    team_id: "academy-1",
    contract_end: "2028-01-01",
    wage: 1000,
    market_value: 10000,
    stats: { appearances: 0, goals: 0, assists: 0, clean_sheets: 0, yellow_cards: 0, red_cards: 0, avg_rating: 0, minutes_played: 0 },
    career: [],
    transfer_listed: false,
    loan_listed: false,
    transfer_offers: [],
    traits: [],
    ...overrides,
  };
}

describe("academySelectors", () => {
  it("returns only main teams when academy teams share the teams collection", () => {
    const main = team({ id: "team-1", team_kind: "Main" });
    const academy = team({ id: "academy-1", team_kind: "Academy", parent_team_id: "team-1" });
    const legacyMain = team({ id: "legacy-team", team_kind: undefined });

    expect(getMainTeams([main, academy, legacyMain]).map((entry) => entry.id)).toEqual([
      "team-1",
      "legacy-team",
    ]);
  });

  it("finds an academy through explicit parent linkage or parent academy id", () => {
    const parent = team({ id: "team-1", team_kind: "Main", academy_team_id: "academy-1" });
    const linkedFromAcademy = team({ id: "academy-1", team_kind: "Academy", parent_team_id: "team-1" });
    const linkedFromParentOnly = team({ id: "academy-1", team_kind: "Academy" });

    expect(findAcademyTeamForParent([parent, linkedFromAcademy], "team-1")?.id).toBe("academy-1");
    expect(findAcademyTeamForParent([parent, linkedFromParentOnly], "team-1")?.id).toBe("academy-1");
  });

  it("returns the real academy roster without including parent roster players", () => {
    const parent = team({ id: "team-1", team_kind: "Main", academy_team_id: "academy-1" });
    const academy = team({ id: "academy-1", team_kind: "Academy", parent_team_id: "team-1" });
    const academyPlayer = player({ id: "academy-player", team_id: "academy-1" });
    const parentPlayer = player({ id: "parent-player", team_id: "team-1" });

    expect(getTeamAcademyRoster([parent, academy], [academyPlayer, parentPlayer], "team-1")).toEqual([
      academyPlayer,
    ]);
  });

  describe("real club linked as an academy", () => {
    const parent = () => team({ id: "team-1", team_kind: "Main", academy_team_id: "les-alpha" });
    const club = () => team({ id: "les-alpha", team_kind: "Main", parent_team_id: "team-1" });

    it("finds the linked Main club by the two ids", () => {
      expect(findAcademyTeamForParent([parent(), club()], "team-1")?.id).toBe("les-alpha");
    });

    it("needs both ids: a one-sided pointer is not a link", () => {
      const strayChild = team({ id: "les-alpha", team_kind: "Main", parent_team_id: "team-1" });
      const strayParent = team({ id: "team-1", team_kind: "Main", academy_team_id: "les-alpha" });
      const unrelated = team({ id: "les-alpha", team_kind: "Main", parent_team_id: null });

      expect(findAcademyTeamForParent([team({ id: "team-1" }), strayChild], "team-1")).toBeNull();
      expect(findAcademyTeamForParent([strayParent, unrelated], "team-1")).toBeNull();
    });

    it("returns the linked club roster", () => {
      const linked = player({ id: "kid", team_id: "les-alpha" });
      const own = player({ id: "pro", team_id: "team-1" });

      expect(getTeamAcademyRoster([parent(), club()], [linked, own], "team-1")).toEqual([linked]);
    });

    it("keeps the linked club in the main teams: it is a normal club", () => {
      expect(isAcademyTeam(club())).toBe(false);
      expect(getMainTeams([parent(), club()]).map((entry) => entry.id)).toEqual([
        "team-1",
        "les-alpha",
      ]);
    });

    it("tells a linked club apart from a plain one and from a copy", () => {
      const teams = [parent(), club(), team({ id: "plain" })];

      expect(isLinkedAcademyClub(teams, club())).toBe(true);
      expect(isLinkedAcademyClub(teams, teams[2])).toBe(false);
      expect(isLinkedAcademyClub(teams, parent())).toBe(false);
    });

    it("marks only the manager's own academy", () => {
      const rival = team({ id: "rival", academy_team_id: "les-beta" });
      const beta = team({ id: "les-beta", parent_team_id: "rival" });
      const teams = [parent(), club(), rival, beta];

      expect(isUserAcademyClub(teams, "team-1", "les-alpha")).toBe(true);
      expect(isUserAcademyClub(teams, "team-1", "les-beta")).toBe(false);
      expect(isUserAcademyClub(teams, null, "les-alpha")).toBe(false);
    });

    it("manages the club, the linked club and a legacy copy", () => {
      const copy = team({ id: "academy-9", team_kind: "Academy", parent_team_id: "team-9" });
      const legacyParent = team({ id: "team-9", academy_team_id: "academy-9" });

      expect([...getManagedTeamIds([parent(), club()], "team-1")].sort()).toEqual([
        "les-alpha",
        "team-1",
      ]);
      expect([...getManagedTeamIds([legacyParent, copy], "team-9")].sort()).toEqual([
        "academy-9",
        "team-9",
      ]);
      expect(getManagedTeamIds([parent(), club()], null).size).toBe(0);
    });
  });
});
