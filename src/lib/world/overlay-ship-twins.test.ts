// @vitest-environment node
// Ship gate: the roster overlay that ships puts nobody into a new world both as a player and as a staff member.
//
// A new world is data/ plus the bundled overlay. The refresh gate `no-player-staff-twins` checks every candidate overlay; this
// test checks the file that ships, so an overlay written past the gate (or by hand) still fails here. Reviewed dual roles
// (a player-coach Leaguepedia lists in both tables of one team) are allowed in `DUAL_ROLES`, and each must still occur.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DUAL_ROLES, playerStaffTwins } from "../../../scripts/world/lib/gates.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";

const root = path.resolve(__dirname, "../../..");
const overlay = JSON.parse(fs.readFileSync(path.join(root, "assets/world/roster-overlay.json"), "utf8"));
const world = loadWorld(path.join(root, "data"));

describe("the shipped roster overlay and player+staff twins", () => {
  it("holds nobody who is both a player and a staff member, reviewed dual roles apart", () => {
    const twins = playerStaffTwins({ overlay, world }).map((t) => `${t.player} ~ ${t.staff} (${t.rule})`);
    expect(twins, `${twins.length} person(s) both a player and a staff member`).toEqual([]);
  });

  it("still holds every reviewed dual role, so the allowlist cannot go stale", () => {
    const all = new Set(playerStaffTwins({ overlay, world, allowed: [] }).map((t) => `${t.player} ~ ${t.staff}`));
    for (const role of DUAL_ROLES) expect(all.has(`${role.player} ~ ${role.staff}`), `${role.player} ~ ${role.staff}`).toBe(true);
  });
});
