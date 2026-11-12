import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import PlayerProfileChampionsCardV2 from "./PlayerProfileChampionsCardV2";

vi.mock("@/lib/champions/championImages", () => ({
  resolveChampionTile: () => null,
  resolveChampionSplash: () => null,
}));

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

const champion = (championId: string, games: number) => ({
  championId,
  championName: championId,
  mastery: 80,
  rank: 1,
  wr: 50,
  games,
});

describe("PlayerProfileChampionsCardV2 in the Spanish UI", () => {
  it("uses the singular for one game and the plural otherwise", () => {
    render(
      <PlayerProfileChampionsCardV2
        champions={[champion("Ahri", 1), champion("Zed", 5)]}
      />,
    );
    expect(screen.getByText("Partida")).toBeInTheDocument();
    expect(screen.getByText("Partidas")).toBeInTheDocument();
  });
});
