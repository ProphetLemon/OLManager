// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  IdCollisionError,
  JITTER,
  PLAYER_ATTRIBUTES,
  approximateBirthDate,
  computeBaselines,
  deterministicId,
  generatePlayer,
  generateStaff,
  seededJitter,
} from "../../../scripts/world/lib/generate.mjs";
import { validateOverlay } from "../../../scripts/world/lib/overlay-schema.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";

const world = loadWorld(FIXTURES.dataDir);
const baselines = computeBaselines(world);
const playerInput = {
  page: "Soboro",
  ign: "Soboro",
  realName: "Lim Seong-min",
  country: "South Korea",
  position: "Top",
  teamId: "lec-fnatic",
  competition: "lec",
  infobox: null,
  baselines,
};
const staffInput = {
  canonicalTitle: "Pad",
  ign: "Pad",
  realName: "Patrick Suckow-Breum",
  country: "Denmark",
  role: "HeadCoach",
  teamId: "lec-team-vitality",
  baselines,
};

describe("deterministic generation", () => {
  it("derives ids from the sha256 of the canonical page title", () => {
    expect(deterministicId("player", "Soboro")).toMatch(/^player-[0-9a-f]{8}$/);
    expect(deterministicId("player", "Soboro")).toBe(deterministicId("player", "Soboro"));
    const digest = createHash("sha256").update("leaguepedia:Soboro").digest("hex").slice(0, 8);
    expect(deterministicId("player", "Soboro")).toBe(`player-${digest}`);
    expect(deterministicId("staff", "Soboro")).toBe(`staff-${digest}`);
    expect(deterministicId("player", "Soboro")).not.toBe(deterministicId("player", "Oscarinin"));
  });

  it("produces byte-identical records for the same input", () => {
    const a = JSON.stringify(generatePlayer(playerInput));
    const b = JSON.stringify(generatePlayer({ ...playerInput }));
    expect(a).toBe(b);
    expect(JSON.stringify(generateStaff(staffInput))).toBe(JSON.stringify(generateStaff({ ...staffInput })));
  });

  it("keeps jitter within +-4 and attributes inside the observed range", () => {
    for (const key of PLAYER_ATTRIBUTES) expect(Math.abs(seededJitter("player-x", key))).toBeLessThanOrEqual(JITTER);
    const { record } = generatePlayer(playerInput);
    const base = baselines.player("lec", "Top").attributes;
    for (const key of PLAYER_ATTRIBUTES) {
      expect(Math.abs(record.attributes[key] - base[key])).toBeLessThanOrEqual(JITTER);
      expect(record.attributes[key]).toBeGreaterThanOrEqual(1);
      expect(record.attributes[key]).toBeLessThanOrEqual(100);
    }
  });

  it("follows the data conventions and validates as an overlay record", () => {
    const player = generatePlayer(playerInput);
    expect(player.record).toMatchObject({ wage: 0, market_value: 0, contract_end: "", nationality: "KR", position: "Top", team_id: "lec-fnatic" });
    expect(player.dobApprox).toBe(true);
    expect(player.record.date_of_birth).toBe(approximateBirthDate(player.record.id));
    const withBirth = generatePlayer({ ...playerInput, infobox: { birthDate: "2004-03-09", name: "Lim Seong-min", country: "South Korea" } });
    expect(withBirth).toMatchObject({ dobApprox: false });
    expect(withBirth.record.date_of_birth).toBe("2004-03-09");

    const overlay = {
      schemaVersion: 1,
      as_of: "2026-11-07",
      source: { name: "Leaguepedia", url: "https://lol.fandom.com", license: "CC BY-SA 3.0", license_url: "https://www.fandom.com/licensing", attribution: "x" },
      coverage: ["lec"],
      players: [{ op: "add", player: player.record, evidence: "https://lol.fandom.com/wiki/Fnatic" }],
      staff: [{ op: "add", staff: generateStaff(staffInput).record, evidence: "https://lol.fandom.com/wiki/Team_Vitality" }],
    };
    expect(validateOverlay(overlay).errors).toEqual([]);
  });

  it("refuses to reuse an id that already exists", () => {
    const { record } = generatePlayer(playerInput);
    expect(() => generatePlayer({ ...playerInput, takenIds: new Set([record.id]) })).toThrow(IdCollisionError);
  });
});
