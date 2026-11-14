import { render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";

vi.mock("@/lib/champions/championImages", () => ({
  resolveChampionTile: () => null,
  resolveChampionSplash: () => null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const statsWithVision = (avgVision: number) => ({
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
  avg_vision: avgVision,
  avg_duration: 1800,
  role_distribution: [{ role: "MID", games: 8, percentage: 80 }],
  best_against: [],
  worst_against: [],
  top_players: [],
  weekly_history: [],
});

async function renderChampion(avgVision: number) {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockResolvedValue(statsWithVision(avgVision));
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  const ChampionPageV2 = (await import("./ChampionPageV2")).default;
  return render(
    <I18nextProvider i18n={instance}>
      <ChampionPageV2 championKey="Ahri" onClose={vi.fn()} />
    </I18nextProvider>,
  );
}

describe("ChampionPageV2 vision tile", () => {
  beforeEach(() => vi.resetModules());

  it("hides the vision tile while no engine records vision, keeping the duration tile", async () => {
    await renderChampion(0);
    await waitFor(() => expect(screen.getByText(en.championPage.duration)).toBeInTheDocument());

    expect(screen.queryByText(en.championPage.vision)).not.toBeInTheDocument();
  });

  it("shows the vision tile once a value above zero exists", async () => {
    await renderChampion(30);
    await waitFor(() => expect(screen.getByText(en.championPage.vision)).toBeInTheDocument());

    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText(en.championPage.duration)).toBeInTheDocument();
  });
});
