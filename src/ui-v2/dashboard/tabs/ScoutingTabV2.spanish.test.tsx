import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { ScoutingTabV2 } from "./ScoutingTabV2";

vi.mock("@/services/scoutingService", () => ({ sendScout: vi.fn() }));

function state(): GameStateData {
  return {
    manager: { id: "manager-1", team_id: "team-1" },
    teams: [{ id: "team-1", name: "Alpha FC", academy_team_id: null }],
    players: [],
    staff: [],
    scouting_assignments: [],
    clock: { current_date: "2026-08-10T00:00:00Z" },
  } as unknown as GameStateData;
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ScoutingTabV2 empty states in the Spanish UI", () => {
  it("writes the no academy and no scouts panels in Spanish", () => {
    render(<ScoutingTabV2 gameState={state()} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("Sin academia")).toBeInTheDocument();
    expect(screen.getByText("Sin equipo de ojeadores")).toBeInTheDocument();
    expect(screen.getByText("Contratar ojeador")).toBeInTheDocument();
    expect(screen.getByText("Evaluar")).toBeInTheDocument();
    expect(screen.getByText("Comparar")).toBeInTheDocument();
    expect(screen.getByText("Descubrir")).toBeInTheDocument();
    expect(screen.getByText("Compara estadísticas y encuentra la mejor opción")).toBeInTheDocument();
    for (const english of [/No Academy/, /No scouting team/, /Hire Scout/, /Compare stats/, /Discover/]) {
      expect(screen.queryByText(english), String(english)).toBeNull();
    }
  });
});
