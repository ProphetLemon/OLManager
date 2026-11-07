import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PlayerProfileChampionsCard from "@/ui-v2/_legacy/components/playerProfile/PlayerProfileChampionsCard";
import { buildTopChampionMasteries } from "@/ui-v2/_legacy/components/playerProfile/PlayerProfile";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("buildTopChampionMasteries", () => {
  const masteries = [
    { player_id: "p1", champion_id: "Ahri", mastery: 90 },
    { player_id: "p1", champion_id: "Zed", mastery: 70 },
    { player_id: "p1", champion_id: "Lux", mastery: 50 },
  ] as never;

  it("ranks by games played when match history exists", () => {
    const performance = new Map([
      ["Lux", { wr: 60, games: 8 }],
      ["Zed", { wr: 50, games: 2 }],
    ]);
    const result = buildTopChampionMasteries("p1", "NoSeedName", "MID", performance, masteries, 3);
    expect(result.map((c) => c.championId)).toEqual(["Lux", "Zed", "Ahri"]);
  });

  it("keeps mastery order when there is no history", () => {
    const result = buildTopChampionMasteries("p1", "NoSeedName", "MID", new Map(), masteries, 3);
    expect(result.map((c) => c.championId)).toEqual(["Ahri", "Zed", "Lux"]);
  });
});

describe("PlayerProfileChampionsCard", () => {
  it("hides games and win rate when the champion has no games", () => {
    render(
      <PlayerProfileChampionsCard
        champions={[
          { championId: "Ahri", championName: "Ahri", mastery: 90, rank: "insignia", wr: 0, games: 0 },
        ]}
      />,
    );
    expect(screen.queryByText(/0\.0%/)).toBeNull();
    expect(screen.queryByText("playerProfile.championGames")).toBeNull();
  });
});
