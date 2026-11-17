// @vitest-environment node
// Ship gate: the rating-overrides asset must match the roster overlay that ships next to it.
//
// An override is keyed by game player id and guarded by `authored_ovr`. The game builds a new world from `data/` plus the bundled
// overlay and skips an override whose id is not in that world (`skipped_missing`) or whose guard no longer equals the player's OVR
// (`skipped_stale`), both only as log counters. After a roster refresh that silently drops a rating, so this test fails instead.
// Fix a failure by rebuilding the asset: `npm run stats:build -- --rows <rows.json>` against the shipped overlay.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadGamePlayers } from "../../../scripts/stats/lib/game-world.mjs";

const root = path.resolve(__dirname, "../../..");
const overridesFile = path.join(root, "assets/world/player-rating-overrides.json");
const overlayFile = path.join(root, "assets/world/roster-overlay.json");

interface Entry {
  id: string;
  authored_ovr: number;
}
const asset = JSON.parse(fs.readFileSync(overridesFile, "utf8")) as { entries: Entry[] };
// The world the game assembles: data/ plus the bundled overlay (moves, retirements and adds, pool included).
const { players } = loadGamePlayers({ dataDir: path.join(root, "data"), overlayFile });
const ovrOf = new Map(players.map((p) => [p.id, p.authoredOvr] as const));

// The 14 duplicate player rows the data dedupe (olmanager-data 2a1acf9) drops. An override on one of them breaks once that data ships, and the
// kept twin carries the same person, so an entry must key to the kept id. Present with or without the dedupe.
const DEDUPE_DROPPED_IDS = [
  "player-f4e49f51", "player-b753c79c", "player-37e12b7d", "player-84345e75", "player-7b51fd6f", "player-1867a3bb", "player-9276105b",
  "player-9a95ae46", "player-a2d61244", "player-a947fb1e", "player-756b6429", "player-a6317295", "player-49258aa1",
];

describe("player-rating-overrides.json matches the shipped roster overlay", () => {
  it("has entries to check", () => {
    expect(asset.entries.length).toBeGreaterThan(0);
    expect(ovrOf.size).toBeGreaterThan(1000);
  });

  it("has no entry for an id that base players plus the overlay do not contain", () => {
    const absent = asset.entries.filter((e) => !ovrOf.has(e.id)).map((e) => e.id);
    expect(absent, `absent ids (the game skips them as skipped_missing): ${absent.join(", ")}`).toEqual([]);
  });

  it("has no entry whose authored_ovr differs from the OVR the game builds for that player", () => {
    const stale = asset.entries
      .filter((e) => ovrOf.has(e.id) && ovrOf.get(e.id) !== e.authored_ovr)
      .map((e) => `${e.id}: authored_ovr ${e.authored_ovr}, the game builds ${ovrOf.get(e.id)}`);
    expect(stale, `stale entries (the game skips them as skipped_stale):\n${stale.join("\n")}`).toEqual([]);
  });

  it("never keys an entry to a row the data dedupe drops", () => {
    const dropped = new Set(DEDUPE_DROPPED_IDS);
    expect(asset.entries.filter((e) => dropped.has(e.id)).map((e) => e.id)).toEqual([]);
  });

  it("keeps the override of every pinned player the roster overlay moved or released", () => {
    const pins = JSON.parse(fs.readFileSync(path.join(root, "scripts/stats/pins.json"), "utf8")) as Record<string, string | null>;
    const keyed = new Set(asset.entries.map((e) => e.id));
    const missing = Object.entries(pins).filter(([, id]) => id && !keyed.has(id)).map(([link, id]) => `${link} (${id})`);
    expect(missing, `pinned players with no override entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("names every player once", () => {
    const seen = new Set<string>();
    const repeated = asset.entries.filter((e) => seen.size === seen.add(e.id).size).map((e) => e.id);
    expect(repeated).toEqual([]);
  });
});
