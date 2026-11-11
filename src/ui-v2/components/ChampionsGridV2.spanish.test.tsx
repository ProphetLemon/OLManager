import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { ChampionData } from "@/store/types";
import ChampionsGridV2 from "./ChampionsGridV2";

vi.mock("@/lib/champions/championImages", () => ({
  resolveChampionTile: () => null,
}));

const champion = (id: number, key: string) => ({ id, champion_key: key, name: key }) as ChampionData;

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ChampionsGridV2 in the Spanish UI", () => {
  it.each([
    [[champion(1, "Ahri")], "1 campeón"],
    [[champion(1, "Ahri"), champion(2, "Zed")], "2 campeones"],
  ])("writes the champion count in Spanish", (champions, expected) => {
    render(<ChampionsGridV2 champions={champions} onChampionClick={() => {}} />);

    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(/champions?$/)).toBeNull();
  });

  it("names the role filters with the translated role", () => {
    render(<ChampionsGridV2 champions={[champion(1, "Ahri")]} onChampionClick={() => {}} />);

    expect(screen.getByTitle("Jungla")).toBeInTheDocument();
    expect(screen.queryByTitle("JUNGLE")).toBeNull();
  });

  it("shows the display name of a champion, not its id without spaces", () => {
    const champions = [champion(1, "AurelionSol"), champion(2, "DrMundo"), champion(3, "MonkeyKing")];
    render(<ChampionsGridV2 champions={champions} onChampionClick={() => {}} />);

    expect(screen.getByText("Aurelion Sol")).toBeInTheDocument();
    expect(screen.getByText("Dr. Mundo")).toBeInTheDocument();
    expect(screen.getByText("Wukong")).toBeInTheDocument();
    expect(screen.queryByText("AurelionSol")).toBeNull();
    expect(screen.queryByText("MonkeyKing")).toBeNull();
  });
});
