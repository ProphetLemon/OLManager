import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GameStateData, PlayerData, StaffData, TeamData } from "@/store/gameStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "common.noTeam": "No team",
        "common.player": "Player",
        "common.position": "Position",
        "common.contract": "Contract",
        "finances.overviewTab": "Overview",
        "finances.facilitiesTab": "Facilities",
        "finances.overview": "Overview",
        "finances.clubBalance": "Club balance",
        "finances.annualWageBudget": "Annual wage budget",
        "finances.annualWageBill": "Annual wage bill",
        "finances.monthlyCommitment": "Monthly commitment",
        "finances.transferBudgetRemaining": "Transfer budget remaining",
        "finances.transferSpendThisSeason": "Transfer spend this season",
        "finances.seasonIncome": "Season income",
        "finances.seasonExpenses": "Season expenses",
        "finances.seasonNet": "Season net",
        "finances.squadValue": "Squad value",
        "finances.perYearSuffix": "/yr",
        "finances.perMonthSuffix": "/mo",
        "finances.budget": "Budget",
        "finances.underBudget": "Under budget",
        "finances.overBudget": "Over budget",
        "finances.wageBill": "Wage bill",
        "finances.playerWages": "Player wages",
        "finances.staffWages": "Staff wages",
        "finances.cashFlow": "Cash flow",
        "finances.annualWageSpend": "Annual wage spend",
        "finances.annualSponsorIncome": "Annual sponsor income",
        "finances.projectedAnnualNet": "Projected annual net",
        "finances.cashRunway": "Cash runway",
        "finances.runwayStable": "Stable",
        "finances.activeSponsor": "Active sponsor",
        "finances.noActiveSponsor": "No active sponsor",
        "finances.contractRisk": "Contract risk",
        "finances.noContractRisks": "No contract risks",
        "finances.payroll": "Payroll",
        "finances.wagePerYear": "Wage",
        "finances.marketValue": "Market value",
        "finances.facilities": "Facilities",
        "finances.recentLedger": "Recent ledger",
        "finances.ledgerEmpty": "No financial ledger entries yet.",
        "finances.ledgerSearchLabel": "Search ledger",
        "finances.ledgerSearchPlaceholder": "Search transactions",
        "finances.ledgerKindFilter": "Transaction type",
        "finances.ledgerSourceFilter": "Source",
        "finances.ledgerAllKinds": "All types",
        "finances.ledgerAllSources": "All sources",
        "finances.ledgerSource.transfer": "Transfer",
        "finances.ledgerSource.monthly": "Monthly",
        "finances.ledgerSource.legacy": "Legacy",
        "finances.ledgerRunningBalance": "Balance",
        "finances.ledgerNoMatches": "No transactions match your filters.",
      };

      if (options && typeof options === "object" && "defaultValue" in options) {
        return String(options.defaultValue);
      }

      return translations[key] ?? key;
    },
  }),
}));

vi.mock("@/lib/i18n/backendI18n", () => ({
  resolveMessage: (message: unknown) => message,
  resolveLedgerDescription: (entry: { description: string }) => entry.description,
}));

vi.mock("@/lib/players/playerPhotos", () => ({
  resolvePlayerPhoto: () => null,
}));

vi.mock("@/lib/squad/helpers", () => ({
  getLolRoleForPlayer: () => "MID",
}));

function createTeam(overrides: Partial<TeamData> = {}): TeamData {
  return {
    id: "team-1",
    name: "Test Team",
    short_name: "TST",
    country: "BR",
    city: "Rio",
    finance: 1_000_000,
    manager_id: "manager-1",
    reputation: 50,
    wage_budget: 500_000,
    transfer_budget: 750_000,
    season_income: 900_000,
    season_expenses: 650_000,
    financial_ledger: [
      {
        date: "2026-01-03",
        description: "Transfer purchase",
        amount: -250_000,
        kind: "TransferPurchase",
        source: "transfer",
        balance_after: 750_000,
      },
      {
        date: "2026-01-04",
        description: "Monthly salary",
        amount: -999_999,
        kind: "Salary",
        source: "monthly",
        balance_after: -249_999,
      },
    ],
    draft_strategy: "Balanced",
    training_focus: "Physical",
    training_intensity: "Medium",
    training_schedule: "Balanced",
    founded_year: 1900,
    colors: { primary: "#111", secondary: "#fff" },
    form: [],
    history: [],
    ...overrides,
  } as TeamData;
}

function createPlayer(overrides: Partial<PlayerData> = {}): PlayerData {
  return {
    id: "player-1",
    match_name: "Mid Player",
    full_name: "Mid Player",
    nationality: "BR",
    team_id: "team-1",
    wage: 120_000,
    market_value: 250_000,
    contract_end: null,
    transfer_listed: false,
    loan_listed: false,
    transfer_offers: [],
    ...overrides,
  } as PlayerData;
}

function createStaff(overrides: Partial<StaffData> = {}): StaffData {
  return {
    id: "staff-1",
    first_name: "Staff",
    last_name: "Coach",
    nationality: "BR",
    role: "Coach",
    team_id: "team-1",
    wage: 60_000,
    contract_end: null,
    ...overrides,
  } as StaffData;
}

function createGameState(): GameStateData {
  return {
    manager: { team_id: "team-1", name: "Coach" },
    teams: [createTeam()],
    players: [createPlayer()],
    staff: [createStaff()],
    leagues: [],
    messages: [],
    clock: { current_date: "2026-01-05" },
    user_competition_id: null,
  } as unknown as GameStateData;
}

describe("FinancesTabV2 summary semantics", () => {
  it("renders like-for-like finance summary labels and values", async () => {
    const { FinancesTabV2 } = await import("./FinancesTabV2");

    render(<FinancesTabV2 gameState={createGameState()} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("Annual wage budget")).toBeInTheDocument();
    expect(screen.getByText("€500K")).toBeInTheDocument();
    expect(screen.getByText("Annual wage bill")).toBeInTheDocument();
    expect(screen.getAllByText("€180,000/yr")).toHaveLength(2);
    expect(screen.getByText("Monthly commitment: €41,666/mo")).toBeInTheDocument();

    expect(screen.getByText("Transfer budget remaining")).toBeInTheDocument();
    expect(screen.getByText("€750K")).toBeInTheDocument();
    expect(screen.getByText("Transfer spend this season: €250K spent")).toBeInTheDocument();

    expect(screen.getByText("Season income")).toBeInTheDocument();
    expect(screen.getByText("€900K")).toBeInTheDocument();
    expect(screen.getByText("Season expenses")).toBeInTheDocument();
    expect(screen.getByText("€650K")).toBeInTheDocument();
    expect(screen.getByText("Season net")).toBeInTheDocument();
    expect(screen.getAllByText("€250K")).toHaveLength(2);
  });

  it("renders a concise populated financial ledger", async () => {
    const { FinancesTabV2 } = await import("./FinancesTabV2");

    render(<FinancesTabV2 gameState={createGameState()} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("Recent ledger")).toBeInTheDocument();
    expect(screen.getByText("2026-01-03")).toBeInTheDocument();
    expect(screen.getAllByText("Transfer purchase").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Transfer").length).toBeGreaterThan(0);
    expect(screen.getByText("Balance: €750K")).toBeInTheDocument();
    expect(screen.getByText("-€250K")).toBeInTheDocument();
    expect(screen.getByText("2026-01-04")).toBeInTheDocument();
    expect(screen.getAllByText("Salary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Monthly").length).toBeGreaterThan(0);
    expect(screen.getByText("-€999,999")).toBeInTheDocument();
  });

  it("filters ledger rows by localized search and shows a useful empty result", async () => {
    const { FinancesTabV2 } = await import("./FinancesTabV2");

    render(<FinancesTabV2 gameState={createGameState()} onGameUpdate={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search ledger"), { target: { value: "transfer" } });
    expect(screen.getAllByText("Transfer purchase").length).toBeGreaterThan(0);
    expect(screen.queryByText("Monthly salary")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search ledger"), { target: { value: "no-match" } });
    expect(screen.getByText("No transactions match your filters.")).toBeInTheDocument();
  });

  it("renders an empty financial ledger state when the team has no entries", async () => {
    const { FinancesTabV2 } = await import("./FinancesTabV2");
    const gameState = createGameState();
    gameState.teams = [createTeam({ financial_ledger: [] })];

    render(<FinancesTabV2 gameState={gameState} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("Recent ledger")).toBeInTheDocument();
    expect(screen.getByText("No financial ledger entries yet.")).toBeInTheDocument();
  });
});
