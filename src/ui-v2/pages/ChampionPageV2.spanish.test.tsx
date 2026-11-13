import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/champions/championImages", () => ({
  resolveChampionTile: () => null,
  resolveChampionSplash: () => null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const ENGLISH_TEXTS = [
  "Champion",
  "No roles played",
  "No data available",
  "No match history",
  "Best Against",
  "Worst Against",
  "Top Players",
  "Weekly",
  "Kills",
  "Deaths",
  "Assists",
  "Gold",
  "Damage",
  "Vision",
  "Duration",
];

const statsFor = (key: string, name: string, overrides: object = {}) => ({
  champion_key: key,
  champion_name: name,
  total_games: 10,
  total_wins: 5,
  win_rate: 50,
  pick_rate: 10,
  ban_rate: 5,
  avg_kills: 3,
  avg_deaths: 2,
  avg_assists: 4,
  avg_kda: 3.5,
  avg_gold: 12000,
  avg_damage: 20000,
  avg_cs: 250,
  avg_vision: 30,
  avg_duration: 1800,
  role_distribution: [],
  best_against: [],
  worst_against: [],
  top_players: [],
  weekly_history: [],
  ...overrides,
});

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ChampionPageV2 in the Spanish UI", () => {
  it("writes the empty states and section titles in Spanish", async () => {
    invokeMock.mockResolvedValue(statsFor("Ahri", "Ahri"));
    const ChampionPageV2 = (await import("./ChampionPageV2")).default;
    render(<ChampionPageV2 championKey="Ahri" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("10 part.")).toBeInTheDocument());

    for (const english of ENGLISH_TEXTS) {
      expect(screen.queryByText(english)).toBeNull();
    }
    expect(screen.getByText("Campeón")).toBeInTheDocument();
    expect(screen.getByText("Sin roles jugados")).toBeInTheDocument();
    expect(screen.getByText("Sin historial de partidas")).toBeInTheDocument();
    expect(screen.getAllByText("Sin datos disponibles").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the display name of a multi-word champion, also for its matchups", async () => {
    invokeMock.mockResolvedValue(
      statsFor("AurelionSol", "AurelionSol", {
        best_against: [{ vs_champion_key: "DrMundo", vs_champion_name: "DrMundo", games: 4, wins: 3, win_rate: 75 }],
        worst_against: [{ vs_champion_key: "MonkeyKing", vs_champion_name: "MonkeyKing", games: 4, wins: 1, win_rate: 25 }],
      }),
    );
    const ChampionPageV2 = (await import("./ChampionPageV2")).default;
    render(<ChampionPageV2 championKey="AurelionSol" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("Dr. Mundo")).toBeInTheDocument());
    expect(screen.getByText("Wukong")).toBeInTheDocument();
    expect(screen.getAllByText("Aurelion Sol").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("AurelionSol")).toBeNull();
    expect(screen.queryByText("DrMundo")).toBeNull();
    expect(screen.queryByText("MonkeyKing")).toBeNull();
  });

  it("writes the KDA and the per-match averages with a decimal comma", async () => {
    invokeMock.mockResolvedValue(statsFor("Ahri", "Ahri", { avg_kda: 3.5, avg_kills: 4.2, avg_deaths: 2.1, avg_assists: 6.8 }));
    const ChampionPageV2 = (await import("./ChampionPageV2")).default;
    render(<ChampionPageV2 championKey="Ahri" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("10 part.")).toBeInTheDocument());
    for (const value of ["3,5", "4,2", "2,1", "6,8"]) {
      expect(screen.getByText(value), value).toBeInTheDocument();
    }
    expect(screen.queryByText("3.5")).toBeNull();
  });
});
