import { render } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData, PlayerSeasonStats } from "@/store/gameStore";
import PlayerProfileCareerCardV2 from "./PlayerProfileCareerCardV2";
import PlayerProfileStatsCardV2 from "./PlayerProfileStatsCardV2";

const t = (key: string, options?: Record<string, string | number>) => i18n.t(key, options as never) as unknown as string;

const STATS = { games_played: 4, wins: 3, losses: 1, kills: 20, deaths: 5, assists: 30, cs: 800, vision_score: 90 } as PlayerSeasonStats;
const GAME = { teams: [] } as unknown as GameStateData;
const CAREER = [1, 2, 3, 4, 5].map((season) => ({
  season,
  team_id: "t1",
  team_name: "Alpha",
  appearances: 10,
  kills: 20,
  assists: 30,
  avg_rating: 7.2,
}));

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("player profile stats and career cards take their text from the locale", () => {
  it("writes the stats card in English instead of the Spanish code default", async () => {
    await i18n.changeLanguage("en");
    const empty = render(<PlayerProfileStatsCardV2 stats={{} as PlayerSeasonStats} t={t} />);
    expect(empty.container.textContent).toContain("No matches played this season.");
    expect(empty.container.textContent).not.toContain("Sin partidos");
    empty.unmount();

    const full = render(<PlayerProfileStatsCardV2 stats={STATS} t={t} />);
    for (const label of ["Games", "Wins", "Losses", "Vision", "Kills", "Assists"]) {
      expect(full.container.textContent, label).toContain(label);
    }
  });

  it("writes the stats card and the career card in Spanish", async () => {
    await i18n.changeLanguage("es");
    const empty = render(<PlayerProfileStatsCardV2 stats={{} as PlayerSeasonStats} t={t} />);
    expect(empty.container.textContent).toContain("Sin partidos jugados esta temporada.");
    empty.unmount();

    const full = render(<PlayerProfileStatsCardV2 stats={STATS} t={t} />);
    for (const label of ["Partidas", "Victorias", "Derrotas", "Visión", "Asesinatos", "Asistencias"]) {
      expect(full.container.textContent, label).toContain(label);
    }
    full.unmount();

    const career = render(<PlayerProfileCareerCardV2 career={CAREER} gameState={GAME} t={t} />);
    const text = career.container.textContent ?? "";
    expect(text).toContain("Historial de carrera");
    expect(text).toContain("Valoración");
    expect(text).toContain("Ver más (2)");
    expect(text).not.toMatch(/\{count\}|\{\{count\}\}|common\./);
  });

  it("writes the career card in English with the count filled in", async () => {
    await i18n.changeLanguage("en");
    const career = render(<PlayerProfileCareerCardV2 career={CAREER} gameState={GAME} t={t} />);
    const text = career.container.textContent ?? "";
    expect(text).toContain("Career history");
    expect(text).toContain("Show more (2)");
    expect(text).not.toContain("Historial");
  });
});
