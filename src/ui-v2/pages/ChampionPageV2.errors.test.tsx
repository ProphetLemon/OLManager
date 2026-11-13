import { render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

vi.mock("@/lib/champions/championImages", () => ({
  resolveChampionTile: () => null,
  resolveChampionSplash: () => null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const PLAYED = {
  champion_key: "Ahri",
  champion_name: "Ahri",
  total_games: 3,
  total_wins: 2,
  win_rate: 66.7,
  pick_rate: 12.5,
  ban_rate: 3,
  avg_kills: 4,
  avg_deaths: 2,
  avg_assists: 7,
  avg_kda: 5.5,
  avg_gold: 12000,
  avg_damage: 21000,
  avg_cs: 250,
  avg_vision: 30,
  avg_duration: 1800,
  role_distribution: [{ role: "MID", games: 3, percentage: 100 }],
  best_against: [],
  worst_against: [],
  top_players: [{ player_id: "p1", player_name: "Faker", team_name: "T1", games: 3, win_rate: 66.7, avg_kda: 5 }],
  weekly_history: [],
};
const NEVER_PLAYED = { ...PLAYED, total_games: 0, total_wins: 0, win_rate: 0, pick_rate: 0, role_distribution: [], top_players: [] };

async function renderSpanish() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  const ChampionPageV2 = (await import("./ChampionPageV2")).default;
  return render(
    <I18nextProvider i18n={instance}>
      <ChampionPageV2 championKey="Ahri" onClose={vi.fn()} />
    </I18nextProvider>,
  );
}

describe("ChampionPageV2 load states", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("shows and logs a failed load, apart from the no-data state", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValue(new Error("unknown command"));
    await renderSpanish();

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("No se pudieron cargar las estadísticas de este campeón.");
    expect(consoleError).toHaveBeenCalledWith(
      "[ChampionPageV2] get_champion_stats failed",
      expect.objectContaining({ message: "unknown command" }),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says nothing is wrong when the champion was simply never played", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(NEVER_PLAYED);
    await renderSpanish();

    const note = await screen.findByRole("status");

    expect(note).toHaveTextContent("Todavía no se ha jugado ninguna partida con este campeón.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(consoleError).not.toHaveBeenCalledWith("[ChampionPageV2] get_champion_stats failed", expect.anything());
    // The hero rates stay dashes rather than a 0% win rate.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("0,0%")).toBeNull();
  });

  it("shows neither message while loading or when the stats arrive", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(PLAYED);
    await renderSpanish();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(screen.getAllByText("66,7%").length).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("writes rates with the game language's decimal mark", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(PLAYED);
    await renderSpanish();

    await waitFor(() => expect(screen.getByText("12,5%")).toBeInTheDocument());

    expect(screen.getByText("3,0%")).toBeInTheDocument();
    expect(screen.queryByText("66.7%")).toBeNull();
  });
});
