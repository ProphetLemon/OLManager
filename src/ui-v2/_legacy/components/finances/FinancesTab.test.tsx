import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type {
  GameStateData,
  MessageData,
  PlayerData,
  TeamData,
} from "@/store/gameStore";
import FinancesTab from "@/ui-v2/_legacy/components/finances/FinancesTab";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "finances.facilities") return "Facility Hub";
      if (key === "finances.sponsors") return "Sponsors";
      if (key === "finances.activeSponsor") return "Active Sponsor";
      if (key === "finances.noActiveSponsor") return "No active sponsor";
      if (key === "finances.esportsSponsor") return "Esports sponsor";
      if (key === "finances.sponsorWeeklyValue")
        return `Monthly value: €${params?.amount}`;
      if (key === "finances.sponsorRemainingMonths")
        return `${params?.count} months remaining`;
      if (key === "finances.pendingSponsorOffers") return "Pending Offers";
      if (key === "finances.noPendingSponsorOffers")
        return "No pending sponsor offers";
      if (key === "finances.cashFlow") return "Cash Flow";
      if (key === "finances.annualWageSpend") return "Annual Wage Bill";
      if (key === "finances.annualSponsorIncome")
        return "Annual Sponsor Income";
      if (key === "finances.projectedAnnualNet") return "Projected Annual Net";
      if (key === "finances.cashRunway") return "Cash Runway";
      if (key === "finances.runwayMonths")
        return `${params?.count} months at current pace`;
      if (key === "finances.runwayStable") return "Stable at current pace";
      if (key === "finances.wagePressure") return "Wage Pressure";
      if (key === "finances.wageBudgetUsed")
        return `${params?.percent}% of wage budget used`;
      if (key === "finances.contractRisk") return "Contract Risk";
      if (key === "finances.delegateMostRenewals")
        return "Delegate Most Renewals";
      if (key === "finances.delegateSelectedRenewals")
        return "Delegate Selected Renewals";
      if (key === "finances.selectAllAtRisk") return "Select all";
      if (key === "finances.delegatedRenewalsSummary")
        return `${params?.successes} done, ${params?.stalled} pending, ${params?.failures} failed`;
      if (key === "finances.contractRiskCritical") return "Critical";
      if (key === "finances.contractRiskWarning") return "Warning";
      if (key === "finances.contractRiskStable") return "Stable";
      if (key === "finances.contractExpiresOn")
        return `Expires ${params?.date}`;
      if (key === "finances.atRiskWages")
        return `${params?.amount}/yr at risk`;
      if (key === "finances.noContractRisks")
        return "No imminent contract risks";
      if (key === "common.renewContract") return "Renew Contract";
      if (key === "finances.facilityScrimsRoom") return "Scrims Room";
      if (key === "finances.facilityAnalysisRoom") return "Analysis Room";
      if (key === "finances.facilityBootcampArea") return "Bootcamp Area";
      if (key === "finances.facilityRecoverySuite") return "Recovery Suite";
      if (key === "finances.facilityContentStudio") return "Content Studio";
      if (key === "finances.facilityScoutingLab") return "Scouting Lab";
      if (key === "finances.facilityLevel") return `Level ${params?.level}`;
      if (key === "finances.upgradeFacility") return "Upgrade";
      if (key === "finances.hubExpansionRequired") return "Expand hub first";
      if (key === "finances.insufficientFunds") return "Insufficient funds";
      if (key === "finances.monthlyUpkeep")
        return `Monthly upkeep: €${params?.amount}`;
      if (key === "finances.esportsSponsor") return "Esports sponsor";
      if (key === "finances.nextUpgradeCost")
        return `Next upgrade: €${params?.amount}`;
      if (key === "finances.expandOffices") return "Expand offices";
      if (key === "finances.facilityScrimsRoomEffect")
        return "Improves scrim quality";
      if (key === "finances.facilityAnalysisRoomEffect")
        return "Improves review quality";
      if (key === "finances.facilityBootcampAreaEffect")
        return "Improves bootcamp preparation";
      if (key === "finances.facilityRecoverySuiteEffect")
        return "Improves player recovery";
      if (key === "finances.facilityContentStudioEffect")
        return "Improves sponsor activation";
      if (key === "finances.facilityScoutingLabEffect")
        return "Improves scouting reports";
      if (key === "finances.overview") return "Overview";
      if (key === "finances.wageBill") return "Wage Bill";
      if (key === "finances.weeklyTotal") return "Annual Total";
      if (key === "finances.budget") return "Budget";
      if (key === "finances.underBudget") return "Under budget";
      if (key === "finances.overBudget") return "Over budget";
      if (key === "finances.payroll") return "Payroll";
      if (key === "finances.squadValue") return "Squad Value";
      if (key === "finances.clubBalance") return "Club Balance";
      if (key === "finances.wageBudget") return "Wage Budget";
      if (key === "finances.transferBudget") return "Transfer Budget";
      if (key === "finances.seasonIncome") return "Season Income";
      if (key === "finances.seasonExpenses") return "Season Expenses";
      if (key === "finances.perWeekSuffix") return "/wk";
      if (key === "finances.perYearSuffix") return "/yr";
      if (key === "finances.annualTotal") return "Annual Total";
      if (key === "finances.wagePerWeek") return "Wage/wk";
      if (key === "finances.marketValue") return "Market Value";
      if (key === "finances.until") return `Until ${params?.year}`;
      if (key === "common.player") return "Player";
      if (key === "common.position") return "Position";
      if (key === "common.contract") return "Contract";
      if (key === "common.noTeam") return "No team";
      return key;
    },
    i18n: { language: "en" },
  }),
}));

const mockedInvoke = vi.mocked(invoke);

function createTeam(overrides: Partial<TeamData> = {}): TeamData {
  return {
    id: "team-1",
    name: "Alpha FC",
    short_name: "ALP",
    country: "BR",
    city: "Rio",
    stadium_name: "Alpha Arena",
    stadium_capacity: 50000,
    finance: 900000,
    manager_id: "manager-1",
    reputation: 50,
    wage_budget: 50000,
    transfer_budget: 300000,
    season_income: 1000000,
    season_expenses: 500000,
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
      training: 2,
      medical: 1,
      scouting: 3,
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
    nationality: "BR",
    position: "Forward",
    natural_position: "Forward",
    alternate_positions: [],
    training_focus: null,
    attributes: {
      pace: 10,
      stamina: 10,
      strength: 10,
      agility: 10,
      passing: 10,
      shooting: 10,
      tackling: 10,
      dribbling: 10,
      defending: 10,
      positioning: 10,
      vision: 10,
      decisions: 10,
      composure: 10,
      aggression: 10,
      teamwork: 10,
      leadership: 10,
      handling: 10,
      reflexes: 10,
      aerial: 10,
    },
    condition: 80,
    morale: 80,
    team_id: "team-1",
    contract_end: null,
    wage: 1000,
    market_value: 200000,
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

function createSponsorOfferMessage(
  overrides: Partial<MessageData> = {},
): MessageData {
  return {
    id: "sponsor_2025-06-15",
    subject: "Sponsorship Offer — GreenTech Industries",
    body: "GreenTech Industries want to sponsor your club.",
    sender: "Commercial Director",
    sender_role: "Commercial Director",
    date: "2025-06-15",
    read: false,
    category: "Finance",
    priority: "Normal",
    actions: [
      {
        id: "respond",
        label: "Respond",
        action_type: {
          ChooseOption: {
            options: [
              {
                id: "accept",
                label: "Accept the deal",
                description: "Receive €100,000 in sponsorship income.",
              },
              {
                id: "decline",
                label: "Decline politely",
                description: "Turn down the offer.",
              },
            ],
          },
        },
        resolved: false,
      },
    ],
    context: {
      team_id: null,
      player_id: null,
      fixture_id: null,
      match_result: null,
    },
    ...overrides,
  };
}

function createGameState(
  teamOverrides: Partial<TeamData> = {},
  messages: MessageData[] = [],
  players: PlayerData[] = [createPlayer()],
): GameStateData {
  return {
    clock: {
      current_date: "2025-01-20T00:00:00Z",
      start_date: "2025-01-01T00:00:00Z",
    },
    manager: {
      id: "manager-1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "BR",
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
    teams: [createTeam(teamOverrides)],
    players,
    staff: [],
    messages,
    news: [],
    leagues: [{
      id: "league-1",
      name: "League",
      season: 1,
      fixtures: [],
      standings: [],
    }],
    scouting_assignments: [],
    board_objectives: [],
  };
}

describe("FinancesTab facilities", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("renders facility cards with levels and disables upgrades when funds are insufficient", () => {
    const gameState = createGameState({ finance: 200000 });

    render(<FinancesTab gameState={gameState} />);

    expect(screen.getAllByText("Facility Hub").length).toBeGreaterThan(0);
    expect(screen.getByText("Scrims Room")).toBeInTheDocument();
    expect(screen.getByText("Analysis Room")).toBeInTheDocument();
    expect(screen.getByText("Bootcamp Area")).toBeInTheDocument();
    expect(screen.getByText("Recovery Suite")).toBeInTheDocument();
    expect(screen.getByText("Content Studio")).toBeInTheDocument();
    expect(screen.getByText("Scouting Lab")).toBeInTheDocument();
    expect(screen.getAllByText("Level 2")).toHaveLength(1);
    expect(screen.getAllByText("Level 1")).toHaveLength(3);
    expect(screen.getAllByText("Level 3")).toHaveLength(3);

    const upgradeButtons = screen.getAllByRole("button", { name: /Upgrade/ });
    expect(upgradeButtons).toHaveLength(6);
    expect(upgradeButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getAllByText("Insufficient funds")).toHaveLength(4);
  });

  it("invokes facility upgrade and publishes the updated game state", async () => {
    const initialState = createGameState();
    const updatedState = createGameState({
      finance: 650000,
      facilities: {
        training: 2,
        medical: 2,
        scouting: 3,
      },
      season_expenses: 750000,
    });
    const onGameUpdate = vi.fn();
    mockedInvoke.mockResolvedValue(updatedState);

    render(
      <FinancesTab gameState={initialState} onGameUpdate={onGameUpdate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Upgrade Recovery Suite/i }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("upgrade_main_facility_module", {
        module: "RecoverySuite",
      });
    });
    expect(onGameUpdate).toHaveBeenCalledWith(updatedState);
  });

  it("renders active sponsorship and pending sponsor offers", () => {
    const gameState = createGameState(
      {
        sponsorship: {
          sponsor_name: "Acme eSports",
          base_value: 125000,
          remaining_months: 8,
          bonus_criteria: [],
        },
      },
      [createSponsorOfferMessage()],
    );

    render(<FinancesTab gameState={gameState} />);

    expect(screen.getByText("Sponsors")).toBeInTheDocument();
    expect(screen.getByText("Active Sponsor")).toBeInTheDocument();
    expect(screen.getByText("Acme eSports")).toBeInTheDocument();
    expect(screen.getByText("Monthly value: €10417")).toBeInTheDocument();
    expect(screen.getByText("8 months remaining")).toBeInTheDocument();
    expect(screen.getByText("Esports sponsor")).toBeInTheDocument();
    expect(screen.getByText("Pending Offers")).toBeInTheDocument();
    expect(
      screen.getByText("Sponsorship Offer — GreenTech Industries"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Receive €100,000 in sponsorship income."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Accept the deal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Decline politely" }),
    ).toBeInTheDocument();
  });

  it("renders imported teams with incomplete finance and sponsorship fields", () => {
    const gameState = createGameState(
      {
        finance: undefined as unknown as number,
        wage_budget: undefined as unknown as number,
        transfer_budget: undefined as unknown as number,
        season_income: undefined as unknown as number,
        season_expenses: undefined as unknown as number,
        sponsorship: {
          sponsor_name: undefined as unknown as string,
          base_value: undefined as unknown as number,
          remaining_months: undefined as unknown as number,
          bonus_criteria: undefined as unknown as [],
        },
      },
      [],
      [
        createPlayer({
          wage: undefined as unknown as number,
          market_value: undefined as unknown as number,
        }),
      ],
    );

    render(<FinancesTab gameState={gameState} />);

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Active Sponsor")).toBeInTheDocument();
    expect(screen.getByText("Sponsor")).toBeInTheDocument();
    expect(screen.getByText("Monthly value: €0")).toBeInTheDocument();
    expect(screen.getByText("0 months remaining")).toBeInTheDocument();
  });

  it("accepts a sponsor offer through resolve_message_action and publishes the updated state", async () => {
    const initialState = createGameState({}, [createSponsorOfferMessage()]);
    const updatedState = createGameState(
      {
        sponsorship: {
          sponsor_name: "GreenTech Industries",
          base_value: 100000,
          remaining_months: 12,
          bonus_criteria: [],
        },
      },
      [],
    );
    const onGameUpdate = vi.fn();

    mockedInvoke.mockResolvedValue({
      game: updatedState,
      effect: "Offer accepted",
    });

    render(
      <FinancesTab gameState={initialState} onGameUpdate={onGameUpdate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept the deal" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("resolve_message_action", {
        messageId: "sponsor_2025-06-15",
        actionId: "respond",
        optionId: "accept",
      });
    });

    expect(onGameUpdate).toHaveBeenCalledWith(updatedState);
  });

  it("renders a cash-flow projection panel using wages, sponsorship income, and runway", () => {
    const gameState = createGameState(
      {
        finance: 280000,
        sponsorship: {
          sponsor_name: "Acme Corp",
          base_value: 10000,
          remaining_months: 8,
          bonus_criteria: [],
        },
      },
      [],
      [createPlayer({ wage: 2080000, market_value: 200000 })],
    );

    render(<FinancesTab gameState={gameState} />);

    expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    expect(screen.getByText("Annual Wage Bill")).toBeInTheDocument();
    expect(screen.getByText("Annual Sponsor Income")).toBeInTheDocument();
    expect(screen.getByText("Projected Annual Net")).toBeInTheDocument();
    expect(screen.getByText("Cash Runway")).toBeInTheDocument();
    expect(screen.getByText("1 months at current pace")).toBeInTheDocument();
  });

  it("shows monthly upkeep on the installation cards", () => {
    const gameState = createGameState({
      facilities: {
        training: 3,
        medical: 1,
        scouting: 2,
      },
    });

    render(<FinancesTab gameState={gameState} />);

    expect(screen.getAllByText("Monthly upkeep: €40,000")).toHaveLength(1);
    expect(screen.getAllByText("Monthly upkeep: €0")).toHaveLength(4);
    expect(screen.getAllByText("Monthly upkeep: €10,000")).toHaveLength(1);
    expect(screen.getAllByText("Next upgrade: €750,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Next upgrade: €250,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Next upgrade: €500,000").length).toBeGreaterThan(0);
  });

  it("renders wage pressure and contract risk indicators for expiring players", () => {
    const onSelectPlayer = vi.fn();
    const gameState = createGameState(
      {
        wage_budget: 50000,
      },
      [],
      [
        createPlayer({
          id: "player-critical",
          match_name: "Alex Critical",
          full_name: "Alex Critical",
          wage: 35000,
          contract_end: "2025-04-30",
        }),
        createPlayer({
          id: "player-warning",
          match_name: "Ben Warning",
          full_name: "Ben Warning",
          wage: 25000,
          contract_end: "2025-10-15",
        }),
        createPlayer({
          id: "player-stable",
          full_name: "Carl Stable",
          wage: 5000,
          contract_end: "2027-06-30",
        }),
      ],
    );

    render(
      <FinancesTab gameState={gameState} onSelectPlayer={onSelectPlayer} />,
    );

    expect(screen.getAllByText("Wage Pressure").length).toBeGreaterThan(0);
    expect(screen.getByText("130% of wage budget used")).toBeInTheDocument();
    expect(screen.getByText("Contract Risk")).toBeInTheDocument();
    expect(screen.getAllByText("Alex Critical").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ben Warning").length).toBeGreaterThan(0);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Expires 2025-04-30")).toBeInTheDocument();
    expect(screen.getByText("Expires 2025-10-15")).toBeInTheDocument();
    expect(screen.getByText("€60K/yr at risk")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Renew Contract" }),
    ).toHaveLength(2);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Renew Contract" })[0],
    );

    expect(onSelectPlayer).toHaveBeenCalledWith("player-critical", {
      openRenewal: true,
    });
  });

  it("delegates only the selected risky renewals to the assistant and publishes the updated state", async () => {
    const riskyPlayers = [
      createPlayer({
        id: "player-critical",
        match_name: "Alex Critical",
        full_name: "Alex Critical",
        wage: 35000,
        contract_end: "2025-04-30",
      }),
      createPlayer({
        id: "player-warning",
        match_name: "Ben Warning",
        full_name: "Ben Warning",
        wage: 25000,
        contract_end: "2025-10-15",
      }),
    ];
    const initialState = createGameState(
      { wage_budget: 50000 },
      [],
      riskyPlayers,
    );
    const updatedState = createGameState(
      { wage_budget: 50000 },
      [],
      [
        createPlayer({
          id: "player-critical",
          match_name: "Alex Critical",
          full_name: "Alex Critical",
          wage: 36000,
          contract_end: "2028-01-20",
        }),
        createPlayer({
          id: "player-warning",
          match_name: "Ben Warning",
          full_name: "Ben Warning",
          wage: 25000,
          contract_end: "2025-10-15",
        }),
      ],
    );
    const onGameUpdate = vi.fn();

    mockedInvoke.mockResolvedValue({
      game: updatedState,
      report: {
        success_count: 1,
        failure_count: 0,
        stalled_count: 1,
        cases: [],
      },
    });

    render(
      <FinancesTab gameState={initialState} onGameUpdate={onGameUpdate} />,
    );

    fireEvent.click(screen.getByLabelText("Select Ben Warning"));

    fireEvent.click(
      screen.getByRole("button", { name: "Delegate Selected Renewals" }),
    );

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("delegate_renewals", {
        playerIds: ["player-critical"],
        maxWageIncreasePct: 35,
        maxContractYears: 3,
      });
    });

    expect(onGameUpdate).toHaveBeenCalledWith(updatedState);
    expect(screen.getByText("1 done, 1 pending, 0 failed")).toBeInTheDocument();
  });
});
