import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import type { GameStateData } from "@/store/gameStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));

vi.mock("@/lib/players/playerPhotos", () => ({
  resolvePlayerPhoto: () => null,
}));

function gameState(): GameStateData {
  return {
    manager: { team_id: "team-1", name: "Coach" },
    teams: [
      {
        id: "team-1",
        name: "Test Team",
        short_name: "TST",
        training_focus: "Scrims",
        training_intensity: "Medium",
        training_schedule: "Balanced",
        training_groups: [],
        staff_ids: [],
      },
    ],
    players: [],
    staff: [],
    leagues: [],
    messages: [],
    clock: { current_date: "2026-01-05" },
    user_competition_id: null,
  } as unknown as GameStateData;
}

async function renderSpanish() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  const { TrainingTabV2 } = await import("./TrainingTabV2");
  return render(
    <I18nextProvider i18n={instance}>
      <TrainingTabV2 gameState={gameState()} onGameUpdate={vi.fn()} />
    </I18nextProvider>,
  );
}

describe("TrainingTabV2 schedule cards in the Spanish UI", () => {
  beforeEach(() => vi.resetModules());

  it("writes the days per week in Spanish", async () => {
    const { container } = await renderSpanish();

    expect(screen.getByText("6 días/semana")).toBeInTheDocument();
    expect(screen.getByText("4 días/semana")).toBeInTheDocument();
    expect(screen.getByText("2 días/semana")).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/days\/week/);
  });
});
