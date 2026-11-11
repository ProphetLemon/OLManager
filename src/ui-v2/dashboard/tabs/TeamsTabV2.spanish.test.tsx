import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { TeamsTabV2 } from "./TeamsTabV2";

function buildState(): GameStateData {
  return {
    manager: { team_id: "t1" },
    user_competition_id: "lec",
    leagues: [
      {
        id: "lec-league",
        competition_id: "lec",
        name: "LEC",
        season: 1,
        fixtures: [],
        standings: [{ team_id: "t1", played: 2, won: 2, lost: 0, maps_won: 4, maps_lost: 0, points: 6 }],
      },
    ],
    teams: [
      {
        id: "t1",
        name: "Alpha",
        short_name: "ALP",
        competition_id: "lec",
        reputation: 50,
        city: "Madrid",
        founded_year: 2015,
        colors: { primary: "#111", secondary: "#eee" },
      },
    ],
    players: [],
  } as unknown as GameStateData;
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("TeamsTabV2 in the Spanish UI", () => {
  it("writes the sort headers in Spanish instead of printing raw keys", () => {
    const { container } = render(<TeamsTabV2 gameState={buildState()} onSelectTeam={() => {}} />);

    for (const label of ["Pos", "Equipo", "OVR", "Rep", "Valor", "WR", "Jugadores"]) {
      expect(screen.getByRole("button", { name: label }), label).toBeInTheDocument();
    }
    expect(container.textContent).not.toMatch(/teams\.col/i);
  });

  it("writes the search box, the stat labels and the record in Spanish", () => {
    render(<TeamsTabV2 gameState={buildState()} onSelectTeam={() => {}} />);

    expect(screen.getByPlaceholderText("Buscar equipos...")).toBeInTheDocument();
    expect(screen.getByText("Plantilla")).toBeInTheDocument();
    expect(screen.getByText("Valor", { selector: "p, span, div" })).toBeInTheDocument();
    expect(screen.getByText("2PG 0PP · 100%")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search teams/)).toBeNull();
    expect(screen.queryByText("Squad")).toBeNull();
    expect(screen.queryByText(/\dW \dL/)).toBeNull();
  });
});
