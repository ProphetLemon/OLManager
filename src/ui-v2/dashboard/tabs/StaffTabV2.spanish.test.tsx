import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { StaffTabV2 } from "@/ui-v2/dashboard/tabs/StaffTabV2";

vi.mock("@/services/staffService", () => ({
  hireStaff: vi.fn(),
  releaseStaff: vi.fn(),
}));

function emptyState(): GameStateData {
  return {
    clock: { current_date: "2026-08-10T00:00:00Z", start_date: "2026-07-01T00:00:00Z" },
    manager: { id: "manager-1", team_id: "team-1" },
    teams: [{ id: "team-1", name: "Alpha FC", competition_id: null }],
    players: [],
    staff: [],
    leagues: [],
  } as unknown as GameStateData;
}

function expectNoEnglishHints() {
  expect(screen.queryByText(/Try adjusting/)).toBeNull();
  expect(screen.queryByText(/Hire staff from/)).toBeNull();
  expect(screen.queryByText(/All staff are currently/)).toBeNull();
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("StaffTabV2 empty states in the Spanish UI", () => {
  it("hints at the available tab when the club has no staff", () => {
    render(<StaffTabV2 gameState={emptyState()} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("Contrata personal desde la pestaña de disponibles")).toBeInTheDocument();
    expectNoEnglishHints();
  });

  it("suggests changing the filters when a search finds nobody", () => {
    render(<StaffTabV2 gameState={emptyState()} onGameUpdate={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Buscar staff..."), { target: { value: "zzzz" } });
    expect(screen.getByText("Prueba a cambiar los filtros o la búsqueda")).toBeInTheDocument();
    expectNoEnglishHints();
  });

  it("says that nobody is left to hire in the available tab", () => {
    render(<StaffTabV2 gameState={emptyState()} onGameUpdate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Disponibles/ }));
    expect(screen.getByText("Todo el personal tiene contrato actualmente")).toBeInTheDocument();
    expectNoEnglishHints();
  });
});
