import { describe, expect, it } from "vitest";

import { NavGrid } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/navigation";
import {
  BARON_TEAM_GOLD,
  PrototypeSimulation,
  towerTeamGold,
} from "@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

const roster = (prefix: string) =>
  ["TOP", "JGL", "MID", "ADC", "SUP"].map((role) => ({ id: `${prefix}-${role}`, name: `${prefix}-${role}` }));

const snapshot = {
  phase: "Live",
  current_minute: 0,
  home_score: 0,
  away_score: 0,
  home_team: { id: "home", name: "home", players: roster("h") },
  away_team: { id: "away", name: "away", players: roster("a") },
  events: [],
} as unknown as MatchSnapshot;

type BaronSim = {
  state: PrototypeSimulation["state"];
  markNeutralTaken: (key: string, killer?: unknown) => void;
};

describe("prototype team gold", () => {
  it("pays Baron gold to every living teammate, not only the killer", () => {
    const sim = new PrototypeSimulation(new NavGrid([]), snapshot, "economy") as unknown as BaronSim;
    const blue = sim.state.champions.filter((c) => c.team === "blue");
    const red = sim.state.champions.filter((c) => c.team === "red");
    const killer = blue[0];
    blue[4].alive = false;
    const before = [...blue, ...red].map((c) => c.gold);
    sim.state.neutralTimers.entities.baron.alive = true;

    sim.markNeutralTaken("baron", killer);

    const gained = [...blue, ...red].map((c, i) => c.gold - before[i]);
    expect(gained.slice(0, 4)).toEqual([BARON_TEAM_GOLD, BARON_TEAM_GOLD, BARON_TEAM_GOLD, BARON_TEAM_GOLD]);
    expect(gained[4]).toBe(0);
    expect(gained.slice(5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("pays towers by tier", () => {
    expect(towerTeamGold("blue-top-outer")).toBeGreaterThan(0);
    expect(towerTeamGold("blue-top-inner")).toBeLessThanOrEqual(towerTeamGold("blue-top-outer"));
    expect(towerTeamGold("blue-top-inhib-tower")).toBeGreaterThan(0);
  });
});
