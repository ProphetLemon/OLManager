// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyRosterFloor, KEPT_FOR_ROSTER_FLOOR, rosterFloor } from "../../../scripts/world/lib/roster-floor.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";

const world = loadWorld(FIXTURES.dataDir);
const evidence = "https://lol.fandom.com/wiki/X";
const A = "lck-team-bc4c40ec";
const B = "lck-team-932ee946";
const roster = (id: string) => world.players.filter((p) => p.team_id === id);
const entry = (op: Record<string, unknown>, id: string, teamId: string | null) => ({ op, id, teamId, competition: "lck", note: `${op.op} ${id}` });
const release = (id: string, teamId: string) => entry({ op: "move", id, team_id: null, evidence }, id, teamId);

describe("roster floor", () => {
  it("uses the smaller of the minimum and the starting size", () => {
    expect(rosterFloor(8, 5)).toBe(5);
    expect(rosterFloor(3, 5)).toBe(3);
    expect(rosterFloor(0, 5)).toBe(0);
  });

  it("drops every release out of a team that would end under its floor, and reports each", () => {
    const players = roster(A);
    const releases = players.map((p) => release(p.id, A));
    const { players: kept, skipped } = applyRosterFloor({ world, players: releases, minRosterSize: 5 });
    expect(kept).toEqual([]);
    expect(skipped).toHaveLength(players.length);
    expect(skipped[0].kind).toBe(KEPT_FOR_ROSTER_FLOOR);
    expect(skipped[0].detail).toContain(A);
    expect(skipped[0].detail).toMatch(/would end with 0 players, under its floor of 5/);
  });

  it("keeps releases from a team that stays at or above its floor", () => {
    const [first] = roster(A);
    const signing = entry({ op: "add", player: { id: "player-new00001", team_id: A }, evidence }, "player-new00001", A);
    const { players, skipped } = applyRosterFloor({ world, players: [release(first.id, A), signing], minRosterSize: 5 });
    expect(players).toHaveLength(2);
    expect(skipped).toEqual([]);
  });

  it("never drops moves to other teams, retirements or adds, even when the team ends short", () => {
    const members = roster(A);
    const moves = members.slice(0, 2).map((p) => entry({ op: "move", id: p.id, team_id: B, evidence }, p.id, B));
    const retire = entry({ op: "retire", id: members[2].id, evidence }, members[2].id, A);
    const add = entry({ op: "add", player: { id: "player-new00001", team_id: B }, evidence }, "player-new00001", B);
    const releases = members.slice(3).map((p) => release(p.id, A));
    const { players, skipped } = applyRosterFloor({ world, players: [...moves, retire, add, ...releases], minRosterSize: 5 });
    expect(players).toEqual([...moves, retire, add]);
    expect(skipped).toHaveLength(releases.length);
  });

  it("is deterministic", () => {
    const releases = roster(A).map((p) => release(p.id, A));
    const first = applyRosterFloor({ world, players: releases, minRosterSize: 5 });
    expect(applyRosterFloor({ world, players: [...releases], minRosterSize: 5 })).toEqual(first);
  });
});
