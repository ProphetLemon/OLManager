import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import type { AcademyAcquisitionOptionData, GameStateData } from "@/store/gameStore";
import { YouthTabV2 } from "./YouthTabV2";

const getOptions = vi.hoisted(() => vi.fn());

vi.mock("@/services/academyService", () => ({
  getAcademyAcquisitionOptions: getOptions,
  acquireAcademyTeam: vi.fn(),
  promoteAcademyPlayer: vi.fn(),
}));

const attributes = {
  mechanics: 60, laning: 60, teamfighting: 60, macro_play: 60, consistency: 60,
  shotcalling: 60, champion_pool: 60, discipline: 60, mental_resilience: 60,
};

function player(id: string, teamId: string) {
  return {
    id,
    match_name: id,
    full_name: `${id} full`,
    date_of_birth: "2006-01-01",
    nationality: "ES",
    position: "TOP",
    natural_position: "TOP",
    alternate_positions: [],
    attributes,
    condition: 90,
    team_id: teamId,
    contract_end: "2027-06-30",
    wage: 1000,
    market_value: 1000,
    potential_revealed: null,
  };
}

function state(teams: unknown[], players: unknown[]): GameStateData {
  return {
    manager: { id: "m1", team_id: "team-1" },
    teams,
    players,
    staff: [],
    clock: { current_date: "2026-08-10T00:00:00Z" },
  } as unknown as GameStateData;
}

function option(overrides: Partial<AcademyAcquisitionOptionData>): AcademyAcquisitionOptionData {
  return {
    source_team_id: "les-alpha",
    source_team_name: "Alpha Esports",
    source_team_short_name: "ALP",
    source_team_logo_url: null,
    erl_league_id: "les",
    league_name: "LES",
    country: "ES",
    region: "EMEA",
    assignment_rule: "Domestic",
    fallback_reason: null,
    reputation: 3,
    development_level: 2,
    acquisition_cost: 330000,
    rebrand_allowed: true,
    source_identity: {
      source_team_id: "les-alpha",
      original_name: "Alpha Esports",
      original_short_name: "ALP",
      original_logo_url: null,
    },
    ...overrides,
  } as AcademyAcquisitionOptionData;
}

describe("YouthTabV2 with a linked real club", () => {
  beforeEach(() => getOptions.mockReset());

  it("shows the roster of a linked Main club as the academy", () => {
    getOptions.mockResolvedValue({ options: [], blocked_reason: null, region: null });
    const teams = [
      { id: "team-1", name: "Koi", academy_team_id: "les-alpha", team_kind: "Main" },
      { id: "les-alpha", name: "Alpha Esports", parent_team_id: "team-1", team_kind: "Main" },
    ];

    render(<YouthTabV2 gameState={state(teams, [player("kid-one", "les-alpha"), player("pro", "team-1")])} />);

    expect(screen.getByText("kid-one", { selector: "p.text-foreground" })).toBeInTheDocument();
    expect(screen.queryByText("pro")).toBeNull();
    expect(getOptions).not.toHaveBeenCalled();
  });

  it("summarises the linked club's own money: balance, sponsor and monthly wages", () => {
    getOptions.mockResolvedValue({ options: [], blocked_reason: null, region: null });
    const teams = [
      { id: "team-1", name: "Koi", academy_team_id: "les-alpha", team_kind: "Main", finance: 9_000_000 },
      {
        id: "les-alpha",
        name: "Alpha Esports",
        parent_team_id: "team-1",
        team_kind: "Main",
        finance: 1_500_000,
        sponsorship: { sponsor_name: "Tier Co", base_value: 240_000, remaining_months: 10, bonus_criteria: [] },
      },
    ];
    const kid = { ...player("kid-one", "les-alpha"), wage: 36_000 };

    render(<YouthTabV2 gameState={state(teams, [kid, player("pro", "team-1")])} />);

    const card = screen.getByTestId("linked-club-finance");
    expect(within(card).getByText(/1\.5M/)).toBeInTheDocument();
    expect(within(card).getByText(/20K/)).toBeInTheDocument();
    expect(within(card).getByText(/3K/)).toBeInTheDocument();
    expect(within(card).queryByText(/9\.0M/)).toBeNull();
  });

  it("shows no finance summary for a legacy copy", () => {
    getOptions.mockResolvedValue({ options: [], blocked_reason: null, region: null });
    const teams = [
      { id: "team-1", name: "Koi", academy_team_id: "copy", team_kind: "Main" },
      { id: "copy", name: "Copy", parent_team_id: "team-1", team_kind: "Academy", finance: 0 },
    ];

    render(<YouthTabV2 gameState={state(teams, [player("kid-one", "copy")])} />);

    expect(screen.queryByTestId("linked-club-finance")).toBeNull();
  });

  it("offers a real club without the custom name, short name and logo fields", async () => {
    getOptions.mockResolvedValue({
      options: [option({ rebrand_allowed: false, real_club: true })],
      blocked_reason: null,
      region: "EMEA",
    });
    const teams = [{ id: "team-1", name: "Koi", academy_team_id: null, team_kind: "Main" }];

    render(<YouthTabV2 gameState={state(teams, [])} />);

    await waitFor(() => expect(screen.getByText("Alpha Esports")).toBeInTheDocument());
    expect(screen.queryByPlaceholderText(/custom name/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/logo url/i)).toBeNull();
    expect(screen.getByText(/link as your academy/i)).toBeInTheDocument();
  });

  it("keeps the rebrand fields for a legacy copy option", async () => {
    getOptions.mockResolvedValue({
      options: [option({ rebrand_allowed: true })],
      blocked_reason: null,
      region: "EMEA",
    });
    const teams = [{ id: "team-1", name: "Koi", academy_team_id: null, team_kind: "Main" }];

    render(<YouthTabV2 gameState={state(teams, [])} />);

    await waitFor(() => expect(screen.getByText("Alpha Esports")).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/custom name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/logo url/i)).toBeInTheDocument();
  });
});
