import { render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

vi.mock("@/lib/champions/championImages", () => ({
  resolveChampionTile: () => null,
  resolveChampionSplash: () => null,
}));

const STATS = {
  champion_key: "Ahri",
  champion_name: "Ahri",
  total_games: 10,
  total_wins: 6,
  win_rate: 60,
  pick_rate: 12,
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
  role_distribution: [{ role: "MID", games: 8, percentage: 80 }],
  best_against: [
    { vs_champion_key: "Zed", vs_champion_name: "Zed", games: 4, wins: 3, win_rate: 75 },
  ],
  worst_against: [],
  top_players: [],
  weekly_history: [{ week_label: "W1", games: 5, win_rate: 60, avg_kda: 4 }],
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

async function renderSpanish() {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockResolvedValue(STATS);
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

describe("ChampionPageV2 units in the Spanish UI", () => {
  beforeEach(() => vi.resetModules());

  it("writes the number of games and the duration with Spanish units", async () => {
    const { container } = await renderSpanish();
    await waitFor(() => expect(screen.getAllByText("10 part.").length).toBeGreaterThan(0));

    expect(screen.getAllByText("8 part.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 part.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 part.").length).toBeGreaterThan(0);
    expect(screen.getByText("30 min")).toBeInTheDocument();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d+g(?![a-z])/);
    expect(text).not.toMatch(/\d+m(?![a-z])/);
  });
});
