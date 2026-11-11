import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData, PlayerData } from "@/store/gameStore";
import { PlayersTabV2 } from "./PlayersTabV2";

const player = {
  id: "p1",
  match_name: "Zed",
  full_name: "Zed Zed",
  nationality: "ES",
  date_of_birth: "2002-03-04",
  team_id: null,
  position: "Defender",
  natural_position: "Defender",
  alternate_positions: [],
  lol_role: "JUNGLE",
  lol_ovr: 70,
  market_value: 100000,
  wage: 50000,
  transfer_listed: false,
  loan_listed: false,
  attributes: {},
} as unknown as PlayerData;

const gameState = {
  players: [player],
  teams: [],
  leagues: [],
  clock: { current_date: "2027-01-01T12:00:00Z" },
} as unknown as GameStateData;

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("PlayersTabV2 in the Spanish UI", () => {
  it("names the role filters with the translated role, not the raw enum", () => {
    render(<PlayersTabV2 gameState={gameState} onSelectPlayer={() => {}} onSelectTeam={() => {}} />);

    expect(screen.getByRole("button", { name: "Jungla" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jungla" })).toHaveAttribute("title", "Jungla");
    expect(screen.queryByText("JUNGLE")).toBeNull();
    expect(screen.queryByRole("button", { name: /JUNGLE/ })).toBeNull();
  });
});
