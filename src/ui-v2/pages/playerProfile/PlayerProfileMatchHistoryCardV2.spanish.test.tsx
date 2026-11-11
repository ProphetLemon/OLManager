import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { PlayerMatchHistoryEntryData } from "@/store/gameStore";
import PlayerProfileMatchHistoryCardV2 from "./PlayerProfileMatchHistoryCardV2";

function entry(id: string, date: string, result: "Win" | "Loss"): PlayerMatchHistoryEntryData {
  return {
    fixtureId: id,
    season: 2027,
    date,
    competition: "LEC",
    matchday: 1,
    opponentTeamId: "t2",
    opponentName: "Beta",
    side: "Blue",
    result,
    role: "MID",
    championId: null,
    gameDurationSeconds: 1800,
    kills: 1,
    deaths: 2,
    assists: 3,
    cs: 200,
    goldEarned: 10000,
    damageToChampions: 12000,
    visionScore: 20,
    wardsPlaced: 8,
  } as unknown as PlayerMatchHistoryEntryData;
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("PlayerProfileMatchHistoryCardV2 in the Spanish UI", () => {
  it("shows V and D with the whole word for assistive technology", () => {
    render(
      <PlayerProfileMatchHistoryCardV2
        history={[entry("f1", "2027-01-02", "Win"), entry("f2", "2027-01-01", "Loss")]}
        t={(key, options) => i18n.t(key, options)}
        language="es"
      />,
    );

    expect(screen.getByText("V")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("D")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Victoria")).toHaveClass("sr-only");
    expect(screen.getByText("Derrota")).toHaveClass("sr-only");
    expect(screen.queryByText("W")).toBeNull();
    expect(screen.queryByText("L")).toBeNull();
  });
});
