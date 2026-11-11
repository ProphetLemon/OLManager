import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { MarketTabV2 } from "./MarketTabV2";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

vi.mock("@/lib/players/playerPhotos", () => ({ resolvePlayerPhoto: () => null }));

function entry(annualWage: number) {
  return {
    id: "tr-1",
    player_id: "p1",
    player_name: "Zed",
    player_ovr: 70,
    player_position: "MID",
    player_profile_image_url: null,
    from_team_id: "",
    from_team_name: "",
    to_team_id: "t1",
    to_team_name: "Alpha",
    fee: 0,
    annual_wage: annualWage,
    contract_years: 2,
    date: "2026-08-01",
    is_user_involved: false,
    is_user_buying: false,
    was_negotiated: false,
    initial_offer_fee: null,
    negotiation_rounds: 0,
    included_players: [],
  };
}

const gameState = {
  teams: [{ id: "t1", name: "Alpha", short_name: "ALP" }],
} as unknown as GameStateData;

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("MarketTabV2 in the Spanish UI", () => {
  it.each([
    [0, "Salario: €0/año"],
    [150_000, "Salario: €150K/año"],
  ])("writes the yearly wage of %i with the Spanish suffix", async (wage, expected) => {
    invokeMock.mockResolvedValue([entry(wage)]);
    render(<MarketTabV2 gameState={gameState} />);

    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
    expect(screen.queryByText(/\/yr/)).toBeNull();
  });

  it("writes the transfer date in Spanish", async () => {
    invokeMock.mockResolvedValue([entry(150_000)]);
    render(<MarketTabV2 gameState={gameState} />);

    await waitFor(() => expect(screen.getByText("1 ago 2026")).toBeInTheDocument());
    expect(screen.queryByText(/Aug/)).toBeNull();
  });
});
