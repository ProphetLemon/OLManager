import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { CompetitionsTabV2 } from "./CompetitionsTabV2";

const ENGLISH_TEXTS = [
  /Competitions/,
  /Standings/,
  /Teams/,
  /Players/,
  /Matches/,
  /Season/,
  /Select a competition/i,
  /No standings/,
  /^Player$/,
  /^Role$/,
];

function buildState(): GameStateData {
  return {
    leagues: [
      {
        id: "lec-league",
        competition_id: "lec",
        name: "LEC",
        tier: 1,
        active: true,
        season: 1,
        standings: [],
        fixtures: [],
      },
    ],
    teams: [{ id: "t1", name: "Alpha", short_name: "ALP", competition_id: "lec" }],
    players: [
      {
        id: "p1",
        team_id: "t1",
        match_name: "Zed",
        full_name: "Zed Smith",
        position: "MID",
        natural_position: "MID",
        attributes: {},
        lol_role: "MID",
      },
    ],
  } as unknown as GameStateData;
}

function expectNoEnglish() {
  for (const pattern of ENGLISH_TEXTS) {
    expect(screen.queryByText(pattern), String(pattern)).toBeNull();
  }
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("CompetitionsTabV2 in the Spanish UI", () => {
  it("asks to select a competition in Spanish", () => {
    render(<CompetitionsTabV2 gameState={buildState()} />);

    expect(screen.getByText("Competiciones")).toBeInTheDocument();
    expect(screen.getByText("Selecciona una competición para ver los detalles")).toBeInTheDocument();
    expectNoEnglish();
  });

  it("writes the hero counters, the view tabs and the empty states in Spanish", () => {
    render(<CompetitionsTabV2 gameState={buildState()} />);

    fireEvent.click(screen.getByRole("button", { name: /LEC/ }));
    expect(screen.getByText("Temporada 1")).toBeInTheDocument();
    expect(screen.getByText("1 equipo")).toBeInTheDocument();
    expect(screen.getByText("0 partidos")).toBeInTheDocument();
    expect(screen.getAllByText("Equipos").length).toBeGreaterThan(0);
    expect(screen.getByText("No hay clasificación disponible")).toBeInTheDocument();
    expectNoEnglish();

    fireEvent.click(screen.getByRole("button", { name: "Jugadores" }));
    expect(screen.getByText("Jugador")).toBeInTheDocument();
    expect(screen.getByText("Rol")).toBeInTheDocument();
    expectNoEnglish();
  });

  it("writes the league table header with the Spanish abbreviations", () => {
    const state = buildState();
    (state as unknown as { manager: unknown }).manager = { team_id: "t1" };
    state.leagues[0].standings = [
      { team_id: "t1", played: 2, won: 1, lost: 1, maps_won: 2, maps_lost: 2, points: 3 },
    ] as never;
    render(<CompetitionsTabV2 gameState={state} />);

    fireEvent.click(screen.getByRole("button", { name: /LEC/ }));
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);

    expect(headers).toEqual(expect.arrayContaining(["PJ", "PG", "PP", "MG", "MP", "Dif", "WR%"]));
    for (const english of ["Pld", "W", "L", "MW", "ML"]) {
      expect(headers, english).not.toContain(english);
    }
  });
});
