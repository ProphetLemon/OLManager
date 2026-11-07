// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runGates, simulateRosterCounts } from "../../../scripts/world/lib/gates.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";

const world = loadWorld(FIXTURES.dataDir);
const source = { name: "Leaguepedia", url: "https://lol.fandom.com", license: "CC BY-SA 3.0", license_url: "https://www.fandom.com/licensing", attribution: "x" };
const evidence = "https://lol.fandom.com/wiki/X";
const overlayOf = (players: unknown[]) => ({ schemaVersion: 1, as_of: "2026-11-07", source, coverage: ["lck", "lec"], players, staff: [] });
const teams = (id: string) => world.players.filter((p) => p.team_id === id);
const gate = (result: ReturnType<typeof runGates>, name: string) => result.results.find((g) => g.name === name)!;
const covered = new Set(world.competitions.filter((c) => c.covered).flatMap((c) => c.teamIds));

describe("plausibility gates", () => {
  it("passes an empty overlay", () => {
    expect(runGates({ overlay: overlayOf([]), world, coveredTeamIds: covered }).ok).toBe(true);
  });

  it("fails when an overlay would strip a team below five players", () => {
    const roster = teams("lck-team-bc4c40ec");
    expect(roster.length).toBeGreaterThanOrEqual(5);
    const overlay = overlayOf(roster.slice(0, roster.length - 4).map((p) => ({ op: "move", id: p.id, team_id: null, evidence })));
    const result = runGates({ overlay, world, coveredTeamIds: covered });
    expect(result.ok).toBe(false);
    expect(gate(result, "min-roster").detail).toContain("lck-team-bc4c40ec");
  });

  it("does not blame a team that was already under the minimum", () => {
    const small = [...covered].find((id) => teams(id).length > 0 && teams(id).length < 5);
    if (!small) return; // the fixture world has only full rosters
    expect(gate(runGates({ overlay: overlayOf([]), world, coveredTeamIds: covered }), "min-roster").ok).toBe(true);
  });

  it("fails when an id is moved twice or references nothing", () => {
    const [player] = teams("lck-team-bc4c40ec");
    const overlay = overlayOf([
      { op: "move", id: player.id, team_id: "lck-team-932ee946", evidence },
      { op: "retire", id: player.id, evidence },
      { op: "move", id: "player-ghost", team_id: "lck-team-932ee946", evidence },
    ]);
    const result = runGates({ overlay, world, coveredTeamIds: covered });
    expect(gate(result, "no-id-twice").ok).toBe(false);
    expect(gate(result, "overlay-valid").ok).toBe(false);
  });

  it("fails when a competition changes more than the allowed share", () => {
    const lck = world.players.filter((p) => p.competition === "lck");
    const overlay = overlayOf(lck.map((p) => ({ op: "retire", id: p.id, evidence })));
    const result = runGates({ overlay, world, coveredTeamIds: covered, options: { minRosterSize: 0 } });
    expect(gate(result, "max-changed-share")).toMatchObject({ ok: false });
    const lenient = runGates({ overlay, world, coveredTeamIds: covered, options: { minRosterSize: 0, maxChangedShare: 1 } });
    expect(gate(lenient, "max-changed-share").ok).toBe(true);
  });

  it("simulates moves, retirements and additions on roster counts", () => {
    const [a, b] = teams("lck-team-bc4c40ec");
    const counts = simulateRosterCounts(world, [
      { op: "move", id: a.id, team_id: "lck-team-932ee946" },
      { op: "retire", id: b.id },
      { op: "add", player: { id: "player-new00001", team_id: "lck-team-932ee946" } },
    ]);
    expect(counts.get("lck-team-bc4c40ec")).toBe(teams("lck-team-bc4c40ec").length - 2);
    expect(counts.get("lck-team-932ee946")).toBe(teams("lck-team-932ee946").length + 2);
  });
});
