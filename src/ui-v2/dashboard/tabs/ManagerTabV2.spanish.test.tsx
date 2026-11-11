import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { ManagerTabV2 } from "./ManagerTabV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const ENGLISH_TEXTS = [
  /Edit Profile/i,
  /Current Team/i,
  /No career history yet/i,
  /\bPlayers\b/,
  /\bStaff\b/,
  /Recent Results/i,
  /Career Highlights/i,
  /\bSeasons\b/,
  /Best Finish/i,
  /Best Season/i,
  /League Position/i,
  /\d+ Teams/,
];

const standing = (team_id: string, points: number) => ({
  team_id,
  played: 1,
  won: 1,
  lost: 0,
  maps_won: 2,
  maps_lost: 0,
  points,
});

function buildState(careerHistory: unknown[] = []): GameStateData {
  return {
    clock: { current_date: "2026-04-29T00:00:00Z", start_date: "2026-04-01T00:00:00Z" },
    manager: {
      id: "m1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "ES",
      team_id: "t1",
      career_stats: { matches_managed: 4, wins: 2, draws: 0, losses: 2, trophies: 0, best_finish: 3 },
      career_history: careerHistory,
    },
    user_competition_id: "lec",
    leagues: [
      { id: "lec-league", competition_id: "lec", name: "LEC", season: 1, fixtures: [], standings: [standing("t1", 6), standing("t2", 3)] },
    ],
    teams: [{ id: "t1", name: "Alpha", short_name: "ALP", competition_id: "lec", colors: { primary: "#111", secondary: "#eee" } }],
    players: [],
    staff: [],
    messages: [],
    news: [],
  } as unknown as GameStateData;
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ManagerTabV2 in the Spanish UI", () => {
  it("writes the profile, the squad tiles and the empty history in Spanish", () => {
    const { container } = render(<ManagerTabV2 gameState={buildState()} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Equipo actual");
    expect(text).toContain("Jugadores");
    expect(text).toContain("Aún no hay historial de carrera");
    expect(text).toContain("Posición en la liga");
    expect(text).toContain("Editar perfil");
    for (const pattern of ENGLISH_TEXTS) {
      expect(text, String(pattern)).not.toMatch(pattern);
    }
  });

  it("writes the career highlights in Spanish once there is a history", () => {
    const history = [
      { team_id: "t1", team_name: "Alpha", start_date: "2026-01-01", end_date: null, matches: 4, wins: 2, draws: 0, losses: 2, best_finish: 3 },
    ];
    const { container } = render(<ManagerTabV2 gameState={buildState(history)} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Trayectoria");
    expect(text).toContain("Temporadas");
    expect(text).toContain("Mejor puesto");
    for (const pattern of ENGLISH_TEXTS) {
      expect(text, String(pattern)).not.toMatch(pattern);
    }
  });
});
