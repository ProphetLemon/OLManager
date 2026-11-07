import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "transfers.centre": "Transfer Centre",
        "transfers.transferWindow": "Transfer window for {{team}}",
        "transfers.listed": "Listed",
        "finances.transferBudgetRemaining": "Transfer budget remaining",
        "finances.transferSpendThisSeason": "Transfer spend this season",
        "finances.annualWageBudget": "Annual wage budget",
        "finances.annualWageBill": "Annual wage bill",
        "season.windowClosed": "Window closed",
        "season.transferWindowStatus.Closed": "Closed",
      };
      if (options && typeof options === "object" && "defaultValue" in options) {
        return String(options.defaultValue).replace("{{amount}}", String(options.amount ?? ""));
      }
      const translated = translations[key] ?? key;
      return translated.replace("{{team}}", String(options?.team ?? ""));
    },
  }),
}));

vi.mock("@/lib/season/seasonContext", () => ({
  resolveSeasonContext: () => ({
    transfer_window: {
      status: "Closed",
      days_remaining: null,
      days_until_opens: null,
    },
  }),
}));

vi.mock("@/lib/transfers/model", () => ({
  deriveTransferCollections: () => ({
    myTransferList: [],
    myLoanList: [],
    marketPlayers: [],
    erlPlayers: [],
    loanPlayers: [],
    playersWithOffers: [],
  }),
  filterTransferPlayers: (players: PlayerData[]) => players,
  getCurrentTransferList: () => [],
  sortTransferPlayers: (players: PlayerData[]) => players,
}));

vi.mock("@/services/transfersService", () => ({
  counterOffer: vi.fn(),
  makeTransferBid: vi.fn(),
  previewTransferBidFinancialImpact: vi.fn(),
  respondToOffer: vi.fn(),
  negotiatePlayerWage: vi.fn(),
}));

vi.mock("@/ui-v2/dashboard/tabs/transfers/TransferBidDialog", () => ({ default: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/transfers/TransferCounterOfferDialog", () => ({ default: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/transfers/WageNegotiationDialog", () => ({ default: () => null }));
vi.mock("@/ui-v2/components/ui/country-flag", () => ({ CountryFlag: () => null }));
vi.mock("@/lib/players/playerPhotos", () => ({ resolvePlayerPhoto: () => null }));
vi.mock("@/lib/players/lolPlayerStats", () => ({ calculateLolOvr: () => 50 }));
vi.mock("@/lib/players/lolIdentity", () => ({ resolvePlayerCurrentLolRole: () => "MID" }));
vi.mock("@/lib/players/roleIcons", () => ({ ROLE_ICON_PATHS: {} }));
vi.mock("@/lib/common/countries", () => ({ countryName: (country: string) => country }));

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
    season_income: 0,
    season_expenses: 2_000_000,
    financial_ledger: [
      { date: "2026-01-03", description: "Purchase", amount: -250_000, kind: "TransferPurchase" },
      { date: "2026-01-04", description: "Salary", amount: -999_999, kind: "Salary" },
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
    transfer_listed: false,
    loan_listed: false,
    transfer_offers: [],
    ...overrides,
  } as PlayerData;
}

function createGameState(): GameStateData {
  return {
    manager: { team_id: "team-1", name: "Coach" },
    teams: [createTeam()],
    players: [createPlayer()],
    leagues: [],
    clock: { current_date: "2026-01-05" },
    user_competition_id: null,
  } as unknown as GameStateData;
}

describe("TransfersTabV2 finance summary", () => {
  it("shows transfer remaining/spend and annual wage bill with matching units", async () => {
    const { TransfersTabV2 } = await import("./TransfersTabV2");

    render(
      <TransfersTabV2
        gameState={createGameState()}
        onGameUpdate={vi.fn()}
        onSelectPlayer={vi.fn()}
        onSelectTeam={vi.fn()}
      />,
    );

    expect(screen.getByText("Transfer budget remaining")).toBeInTheDocument();
    expect(screen.getByText("€750K")).toBeInTheDocument();
    expect(screen.getByText("Transfer spend this season")).toBeInTheDocument();
    expect(screen.getByText("€250K spent")).toBeInTheDocument();
    expect(screen.getByText("Annual wage budget")).toBeInTheDocument();
    expect(screen.getByText("€500K /yr")).toBeInTheDocument();
    expect(screen.getByText("Annual wage bill")).toBeInTheDocument();
    expect(screen.getByText("€120K /yr")).toBeInTheDocument();
  });
});

describe("TransfersTabV2 state across profile round-trip", () => {
  it("restores the search filter after unmount and remount", async () => {
    const { TransfersTabV2 } = await import("./TransfersTabV2");
    const props = {
      gameState: createGameState(),
      onGameUpdate: vi.fn(),
      onSelectPlayer: vi.fn(),
      onSelectTeam: vi.fn(),
    };
    const first = render(<TransfersTabV2 {...props} />);
    fireEvent.change(screen.getByPlaceholderText("transfers.searchByName"), {
      target: { value: "faker" },
    });
    first.unmount();

    render(<TransfersTabV2 {...props} />);
    expect(screen.getByPlaceholderText("transfers.searchByName")).toHaveValue("faker");
  });
});
