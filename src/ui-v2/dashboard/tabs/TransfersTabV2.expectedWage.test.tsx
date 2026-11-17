import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";
import { useTabUiStore } from "@/store/tabUiStore";

const getExpectedSigningWages = vi.fn();

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/season/seasonContext", () => ({
  resolveSeasonContext: () => ({
    transfer_window: { status: "Closed", days_remaining: null, days_until_opens: null },
  }),
}));

vi.mock("@/lib/transfers/model", async () => {
  const freeAgent = (id: string, wage: number) =>
    ({ id, match_name: id, full_name: id, nationality: "KR", team_id: null, wage, market_value: 140_000,
      transfer_listed: false, loan_listed: false, transfer_offers: [], date_of_birth: "2004-02-25" }) as unknown as PlayerData;
  const market = [freeAgent("send0o", 0), freeAgent("paid-fa", 90_000)];
  return {
    deriveTransferCollections: () => ({
      myTransferList: [], myLoanList: [], marketPlayers: market, erlPlayers: [], loanPlayers: [], playersWithOffers: [],
    }),
    filterTransferPlayers: (players: PlayerData[]) => players,
    getCurrentTransferList: () => market,
    sortTransferPlayers: (players: PlayerData[]) => players,
  };
});

vi.mock("@/services/transfersService", () => ({
  counterOffer: vi.fn(),
  makeTransferBid: vi.fn(),
  previewTransferBidFinancialImpact: vi.fn(),
  respondToOffer: vi.fn(),
  negotiatePlayerWage: vi.fn(),
  getExpectedSigningWages: (ids: string[]) => getExpectedSigningWages(ids),
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

const team = {
  id: "team-1", name: "Test Team", short_name: "TST", country: "BR", finance: 1_000_000, manager_id: "m1",
  reputation: 50, wage_budget: 500_000, transfer_budget: 750_000, season_income: 0, season_expenses: 0,
  financial_ledger: [], form: [], history: [], colors: { primary: "#111", secondary: "#fff" },
} as unknown as TeamData;

const gameState = {
  manager: { team_id: "team-1", name: "Coach" },
  teams: [team],
  players: [],
  leagues: [],
  clock: { current_date: "2026-01-05" },
  user_competition_id: null,
} as unknown as GameStateData;

describe("TransfersTabV2 market wage column", () => {
  beforeEach(() => {
    getExpectedSigningWages.mockReset();
    useTabUiStore.getState().setTabField("transfers", "view", "market");
  });

  it("shows the expected wage for a wage-0 free agent and leaves real wages alone", async () => {
    getExpectedSigningWages.mockResolvedValue({ send0o: 211_000 });
    const { TransfersTabV2 } = await import("./TransfersTabV2");

    render(
      <TransfersTabV2 gameState={gameState} onGameUpdate={vi.fn()} onSelectPlayer={vi.fn()} onSelectTeam={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(/€211K/)).toBeInTheDocument());
    expect(screen.getByText(/€90K/)).toBeInTheDocument();
    const row = screen.getByText("send0o").closest("tr") as HTMLElement;
    expect(within(row).queryByText(/€0\b/)).not.toBeInTheDocument();
    expect(getExpectedSigningWages).toHaveBeenCalledWith(["send0o"]);
  });
});
