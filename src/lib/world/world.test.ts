// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyCatalogCorrections,
  coveredCompetitionIds,
  effectiveTeamId,
  loadWorld,
  readCatalogCorrections,
  toOverlayWorld,
} from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";

describe("loadWorld", () => {
  const world = loadWorld(FIXTURES.dataDir);

  it("prefixes ids with the competition like the game does and keeps free agents teamless", () => {
    expect(effectiveTeamId("team-bc4c40ec", "lck")).toBe("lck-team-bc4c40ec");
    expect(effectiveTeamId("lec-fnatic", "lec")).toBe("lec-fnatic");
    expect(effectiveTeamId("fa", "lck")).toBeNull();
    expect(effectiveTeamId("freeagent", "lck")).toBeNull();
    expect(effectiveTeamId(null, "lck")).toBeNull();
    expect(world.players.find((p) => p.match_name === "Vincenzo")?.team_id).toBeNull();
  });

  it("covers live competitions and excludes stale duplicates", () => {
    expect(coveredCompetitionIds(world).sort()).toEqual(["lck", "lckcl", "lec"]);
    expect(world.competitions.find((c) => c.id === "lck-cl")).toMatchObject({ covered: false, staleOf: "lckcl" });
  });

  it("de-duplicates ids across shards, live shard first, and reports the duplicates", () => {
    const jiwoo = world.players.filter((p) => p.id === "player-f9ead664");
    expect(jiwoo).toHaveLength(1);
    expect(jiwoo[0].shard).toBe("players/lckcl");
    expect(world.duplicates.players.find((d) => d.id === "player-f9ead664")?.shards).toEqual(["players/lckcl", "players/lck-cl"]);
  });

  it("exposes id sets for the overlay validator", () => {
    const ids = toOverlayWorld(world);
    expect(ids.playerIds.has("player-f9ead664")).toBe(true);
    expect(ids.teamIds.has("lck-team-bc4c40ec")).toBe(true);
    expect(ids.competitionIds.has("lec")).toBe(true);
  });

  it("turns players whose team is not in the world into free agents", () => {
    const teamIds = new Set(world.teams.keys());
    expect(world.players.every((p) => p.team_id === null || teamIds.has(p.team_id))).toBe(true);
    expect(world.players.find((p) => p.id === "player-9010ea3a")?.team_id).toBeNull();
  });

  it("applies reviewed corrections to the loaded world and reports them", () => {
    const fixed = loadWorld(FIXTURES.dataDir, {
      corrections: [{ id: "player-f9ead664", field: "full_name", from: world.players.find((p) => p.id === "player-f9ead664")!.full_name, to: "Corrected Name", evidence: "test" }],
    });
    expect(fixed.players.find((p) => p.id === "player-f9ead664")).toMatchObject({ full_name: "Corrected Name" });
    expect(fixed.corrections).toEqual({ applied: 1, skipped: [] });
  });

  it("skips corrections with an unknown id, field or stale from value instead of throwing", () => {
    const players = [{ id: "p1", full_name: "A", raw: {} }] as any;
    const report = applyCatalogCorrections(players, [
      { id: "nope", field: "full_name", from: "A", to: "B", evidence: "t" },
      { id: "p1", field: "wage" as any, from: "A", to: "B", evidence: "t" },
      { id: "p1", field: "full_name", from: "stale", to: "B", evidence: "t" },
    ]);
    expect(report.applied).toBe(0);
    expect(report.skipped).toHaveLength(3);
    expect(players[0].full_name).toBe("A");
  });

  it("ships a bundled corrections file where every entry cites its evidence", () => {
    const bundled = readCatalogCorrections();
    expect(bundled.length).toBeGreaterThan(0);
    expect(bundled.every((c) => c.evidence.trim().length > 0)).toBe(true);
  });
});
