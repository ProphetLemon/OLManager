import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import OpponentIntelCard from "./OpponentIntelCard";
import type { OpponentIntelSnapshot } from "./opponentIntelService";

async function renderCard(quality: "low" | "medium" | "high", roles: string[], suggestedBans: OpponentIntelSnapshot["suggestedBans"] = [], lng = "es") {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng,
    fallbackLng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  const intel: OpponentIntelSnapshot = {
    playerPools: roles.map((role, index) => ({ playerName: `Rival ${index}`, role, champions: [] })),
    masteryHighlights: [],
    suggestedBans,
    metaThreats: [],
    confidence: { mappedPlayers: 0, totalPlayers: 5, poolCoveragePct: 100, qualityLabel: quality },
  };
  return render(
    <I18nextProvider i18n={instance}>
      <OpponentIntelCard intel={intel} />
    </I18nextProvider>,
  );
}

describe("OpponentIntelCard in the Spanish UI", () => {
  it.each([
    ["high", "ALTA · 100%"],
    ["medium", "MEDIA · 100%"],
    ["low", "BAJA · 100%"],
  ] as const)("writes the %s confidence in Spanish", async (quality, expected) => {
    await renderCard(quality, []);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(/HIGH|MEDIUM|LOW/)).toBeNull();
  });

  it("translates the unknown role and the known roles of a rival", async () => {
    await renderCard("high", ["Unknown", "JUNGLE"]);
    expect(screen.getByText("(Desconocido)")).toBeInTheDocument();
    expect(screen.getByText("(Jungla)")).toBeInTheDocument();
    expect(screen.queryByText(/Unknown|JUNGLE/)).toBeNull();
  });

  it.each([
    ["es", "7,3"],
    ["en", "7.3"],
  ])("writes the ban threat score with the %s decimal mark", async (lng, expected) => {
    await renderCard("high", [], [{ championId: "Ahri", championName: "Ahri", threatScore: 7.25 } as never], lng);
    expect(screen.getByText(new RegExp(expected.replace(".", "\\.")))).toBeInTheDocument();
  });
});
