import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import type { TransferBidProjectionData } from "@/services/transfersService";
import PlayerProfileTransferOfferModalV2 from "./PlayerProfileTransferOfferModalV2";

async function renderModal(isFreeAgent: boolean) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  const projection: TransferBidProjectionData["projection"] = {
    transfer_budget_before: 2_000_000,
    transfer_budget_after: 800_000,
    finance_before: 5_000_000,
    finance_after: -100_000,
    annual_wage_bill_before: 1_000,
    annual_wage_bill_after: 2_000,
    annual_wage_budget: 50_000,
    projected_wage_budget_usage_pct: 4,
    exceeds_transfer_budget: true,
    exceeds_finance: true,
  };
  return render(
    <PlayerProfileTransferOfferModalV2
      t={instance.t.bind(instance) as never}
      playerName="Jungle Player"
      isFreeAgent={isFreeAgent}
      managerTeam={null}
      academyTeam={null}
      destination="main"
      amount="1200000"
      error={null}
      feedback={null}
      projection={projection}
      projectionFee={1_200_000}
      submitting={false}
      onDestinationChange={vi.fn()}
      onAmountChange={vi.fn()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("PlayerProfileTransferOfferModalV2 in the Spanish UI", () => {
  it("writes the destination field and the free agent hint in Spanish", async () => {
    await renderModal(true);
    expect(screen.getByText("Destino")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Primer equipo" })).toBeInTheDocument();
    expect(
      screen.getByText("Este jugador es agente libre y puede fichar sin pagar traspaso."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Destination|Main team|free agent/)).toBeNull();
  });

  it("writes the projected impact lines in Spanish", async () => {
    await renderModal(false);
    expect(screen.getByText("Impacto previsto")).toBeInTheDocument();
    expect(screen.getByText(/^Presupuesto de fichajes /)).toBeInTheDocument();
    expect(screen.getByText(/^Balance del club /)).toBeInTheDocument();
    expect(screen.getByText("Esta oferta supera tu presupuesto de fichajes")).toBeInTheDocument();
    expect(screen.getByText("Esta oferta dejaría al club en números rojos")).toBeInTheDocument();
    expect(screen.queryByText(/Projected|Transfer budget|Club balance|This bid/)).toBeNull();
  });
});
