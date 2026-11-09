import { describe, expect, it } from "vitest";

import type { GameStateData } from "@/store/gameStore";
import { getPendingIncomingOffersCount } from "./helpers";

function player(id: string, teamId: string | null, statuses: string[]) {
  return {
    id,
    team_id: teamId,
    transfer_offers: statuses.map((status, i) => ({ id: `${id}-o${i}`, status })),
  };
}

function game(players: ReturnType<typeof player>[]): GameStateData {
  return { manager: { team_id: "mine" }, players } as unknown as GameStateData;
}

describe("getPendingIncomingOffersCount", () => {
  it("counts pending offers on the user's players", () => {
    const gs = game([
      player("a", "mine", ["Pending", "Pending"]),
      player("b", "mine", ["Pending"]),
    ]);
    expect(getPendingIncomingOffersCount(gs)).toBe(3);
  });

  it("ignores resolved offers", () => {
    const gs = game([player("a", "mine", ["Accepted", "Rejected", "Withdrawn"])]);
    expect(getPendingIncomingOffersCount(gs)).toBe(0);
  });

  it("ignores offers on other teams' players (the user's own bids)", () => {
    const gs = game([player("a", "rival", ["Pending"])]);
    expect(getPendingIncomingOffersCount(gs)).toBe(0);
  });
});
