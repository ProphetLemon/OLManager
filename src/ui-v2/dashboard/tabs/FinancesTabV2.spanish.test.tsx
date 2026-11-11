import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { setActiveCurrency } from "@/lib/formatting/valueFormatting";
import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@/lib/players/playerPhotos", () => ({
  resolvePlayerPhoto: () => null,
}));

vi.mock("@/lib/squad/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/squad/helpers")>()),
  getLolRoleForPlayer: () => "JUNGLE",
}));

function team(overrides: Partial<TeamData> = {}): TeamData {
  return {
    id: "team-1",
    name: "Test Team",
    short_name: "TST",
    finance: 1_000_000,
    wage_budget: 500_000,
    transfer_budget: 750_000,
    season_income: 900_000,
    season_expenses: 650_000,
    financial_ledger: [],
    sponsorship: null,
    ...overrides,
  } as unknown as TeamData;
}

function player(overrides: Partial<PlayerData> = {}): PlayerData {
  return {
    id: "player-1",
    match_name: "Jungle Player",
    team_id: "team-1",
    wage: 120_000,
    market_value: 250_000,
    contract_end: null,
    ...overrides,
  } as unknown as PlayerData;
}

function gameState(players: PlayerData[], teamOverrides: Partial<TeamData> = {}): GameStateData {
  return {
    manager: { team_id: "team-1", name: "Coach" },
    teams: [team(teamOverrides)],
    players,
    staff: [],
    leagues: [],
    messages: [],
    clock: { current_date: "2026-01-05" },
    user_competition_id: null,
  } as unknown as GameStateData;
}

async function renderSpanish(state: GameStateData) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  const { FinancesTabV2 } = await import("./FinancesTabV2");
  return render(
    <I18nextProvider i18n={instance}>
      <FinancesTabV2 gameState={state} onGameUpdate={vi.fn()} />
    </I18nextProvider>,
  );
}

describe("FinancesTabV2 in the Spanish UI", () => {
  beforeEach(() => {
    vi.resetModules();
    setActiveCurrency("EUR");
  });
  afterEach(() => setActiveCurrency("EUR"));

  it("prints a negative projected annual net with the sign before the symbol", async () => {
    await renderSpanish(gameState([player({ wage: 1_628_000 })]));
    expect(screen.getAllByText(/^-€1[.,]628[.,]000\/año$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/€-/)).toBeNull();
  });

  it("prints a positive projected annual net without a sign", async () => {
    await renderSpanish(
      gameState([player({ wage: 100_000 })], {
        sponsorship: { base_value: 400_000 },
      } as unknown as Partial<TeamData>),
    );
    expect(screen.getAllByText(/^€300[.,]000\/año$/).length).toBeGreaterThan(0);
  });

  it("prints a zero projected annual net as plain zero", async () => {
    await renderSpanish(gameState([]));
    expect(screen.getAllByText("€0/año").length).toBeGreaterThan(0);
    expect(screen.queryByText(/€-?0\/año.*-/)).toBeNull();
  });

  it("writes the currency symbol once in the wages at risk text", async () => {
    await renderSpanish(gameState([player({ wage: 120_000, contract_end: "2026-03-01" })]));
    expect(screen.getByText("€120K/año en riesgo")).toBeInTheDocument();
    expect(screen.queryByText(/€€/)).toBeNull();
  });

  it("prints a zero amount of wages at risk once", async () => {
    await renderSpanish(gameState([player({ contract_end: "2030-03-01" })]));
    expect(screen.getByText("€0/año en riesgo")).toBeInTheDocument();
  });

  it("keeps the transfer spend sentence in Spanish", async () => {
    await renderSpanish(
      gameState([player()], { transfer_budget: 750_000 } as unknown as Partial<TeamData>),
    );
    const sentence = screen.getByText(/^Gasto en fichajes esta temporada:/);
    expect(sentence.textContent).toMatch(/gastado$/);
    expect(sentence.textContent).not.toMatch(/spent/);
  });

  it("labels the wage column per year and shows the role in Spanish", async () => {
    await renderSpanish(gameState([player()]));
    expect(screen.getByText("Salario/año")).toBeInTheDocument();
    expect(screen.queryByText("Salario/sem")).toBeNull();
    expect(screen.getByText("Jungla")).toBeInTheDocument();
    expect(screen.queryByText("JUNGLE")).toBeNull();
  });
});
