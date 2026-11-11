import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import type { PlayerData, TeamData, TransferOfferData } from "@/store/gameStore";
import type { TransferBidProjectionData } from "@/services/transfersService";
import TransferBidDialog from "./TransferBidDialog";

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
    team_id: "team-2",
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
    transfer_listed: true,
    loan_listed: false,
    transfer_offers: [],
    traits: [],
    ...overrides,
  };
}

function createOffer(overrides: Partial<TransferOfferData> = {}): TransferOfferData {
  return {
    id: "offer-1",
    from_team_id: "team-1",
    fee: 1200000,
    wage_offered: 0,
    last_manager_fee: 1000000,
    negotiation_round: 2,
    suggested_counter_fee: 1500000,
    status: "Pending",
    date: "2026-08-01",
    ...overrides,
  };
}

function createProjection(
  overrides: Partial<TransferBidProjectionData["projection"]> = {},
): TransferBidProjectionData["projection"] {
  return {
    transfer_budget_before: 2000000,
    transfer_budget_after: 800000,
    finance_before: 5000000,
    finance_after: 3800000,
    annual_wage_bill_before: 1000,
    annual_wage_bill_after: 2000,
    annual_wage_budget: 50000,
    projected_wage_budget_usage_pct: 4,
    exceeds_transfer_budget: false,
    exceeds_finance: false,
    ...overrides,
  };
}

async function renderDialog(player: PlayerData, isFreeAgent: boolean) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={instance}>
      <TransferBidDialog
        bidTarget={player}
        teams={[createTeam(), createTeam({ id: "team-2", name: "Seller FC" })]}
        currentDate="2025-01-15"
        bidAmount="1500000"
        onBidAmountChange={vi.fn()}
        destination="main"
        onDestinationChange={vi.fn()}
        academyTeam={null}
        myTeam={createTeam()}
        bidFee={1500000}
        bidProjection={createProjection({ exceeds_transfer_budget: true, exceeds_finance: true })}
        bidFeedback={null}
        activeBidOffer={createOffer()}
        hasExistingOffer={false}
        bidResult={null}
        bidLoading={false}
        bidSubmitDisabled={false}
        userPlayers={[]}
        selectedPlayerIds={[]}
        onSelectedPlayersChange={vi.fn()}
        isFreeAgent={isFreeAgent}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    </I18nextProvider>,
  );
}

describe("TransferBidDialog in the Spanish UI", () => {
  it("names the free agent and the destination field in Spanish", async () => {
    await renderDialog(createPlayer({ team_id: null }), true);
    expect(screen.getByText(/Agente Libre/)).toBeInTheDocument();
    expect(screen.getByText("Destino")).toBeInTheDocument();
    expect(screen.queryByText(/Free Agent/)).toBeNull();
    expect(screen.queryByText("Destination")).toBeNull();
  });

  it("writes the projected impact lines in Spanish", async () => {
    await renderDialog(createPlayer(), false);
    expect(screen.getByText("Impacto previsto")).toBeInTheDocument();
    expect(screen.getByText(/^Presupuesto de fichajes /)).toBeInTheDocument();
    expect(screen.getByText(/^Balance del club /)).toBeInTheDocument();
    expect(screen.getByText(/^Uso previsto del presupuesto salarial: 4%/)).toBeInTheDocument();
    expect(screen.getByText("Esta oferta supera tu presupuesto de fichajes")).toBeInTheDocument();
    expect(screen.getByText("Esta oferta dejaría al club en números rojos")).toBeInTheDocument();
    expect(screen.queryByText(/Projected|Transfer budget|Club balance|This bid/)).toBeNull();
  });
});
