import { describe, expect, it } from "vitest";

import type { PlayerData, TeamData } from "@/store/gameStore";
import { filterScoutablePlayers } from "@/lib/scouting/model";

// Shaped like a free agent the active-pros pool adds: no team, an ISO-2 nationality, no contract.
const poolFreeAgent = {
  id: "player-bea33543",
  full_name: "Rosendo Fuentes Boveda",
  match_name: "Send0o",
  nationality: "ES",
  position: "TOP",
  natural_position: "TOP",
  team_id: null,
  contract_end: null,
  wage: 0,
  market_value: 120000,
  attributes: {},
} as unknown as PlayerData;

const ownPlayer = { ...poolFreeAgent, id: "own", match_name: "Own", full_name: "Own Player", team_id: "team-1" } as PlayerData;
const teams = [{ id: "team-1", name: "Alpha FC" }] as TeamData[];

const scoutable = (posFilter: string, searchQuery: string) =>
  filterScoutablePlayers({ players: [ownPlayer, poolFreeAgent], teams, myTeamId: "team-1", posFilter, searchQuery }).map(
    (player) => player.id,
  );

describe("scouting/model filterScoutablePlayers", () => {
  it("includes a teamless pool free agent and leaves the user's own players out", () => {
    expect(scoutable("All", "")).toEqual(["player-bea33543"]);
  });

  it("finds the free agent by role, nick and country", () => {
    expect(scoutable("TOP", "")).toEqual(["player-bea33543"]);
    expect(scoutable("All", "send0o")).toEqual(["player-bea33543"]);
    expect(scoutable("All", "spain")).toEqual(["player-bea33543"]);
  });
});
