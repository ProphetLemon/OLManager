// @vitest-environment node
import { describe, expect, it } from "vitest";
import { coveredCompetitionIds, effectiveTeamId, loadWorld, toOverlayWorld } from "../../../scripts/world/lib/world.mjs";
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
});
