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
});
