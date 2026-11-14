// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generatePlayer, generateStaff, computeBaselines } from "../../../scripts/world/lib/generate.mjs";
import { validateOverlay } from "../../../scripts/world/lib/overlay-schema.mjs";
import { loadWorld, toOverlayWorld } from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";

const world = loadWorld(FIXTURES.dataDir);
const ids = toOverlayWorld(world);
const valid = () => ({
  schemaVersion: 1,
  as_of: "2026-11-07",
  source: { name: "Leaguepedia", url: "https://lol.fandom.com", license: "CC BY-SA 3.0", license_url: "https://www.fandom.com/licensing", attribution: "Leaguepedia contributors" },
  coverage: ["lck"],
  players: [
    { op: "move", id: "player-c5877188", team_id: "lck-team-bc4c40ec", evidence: "https://lol.fandom.com/wiki/Kiwoom_DRX" },
    { op: "retire", id: "lec-player-105501834624360050", evidence: "https://lol.fandom.com/wiki/Ice_(Yoon_Sang-hoon)" },
  ],
  staff: [],
});
const codes = (overlay: unknown, withWorld = true) => validateOverlay(overlay, withWorld ? ids : undefined).errors.map((e) => e.code);

describe("validateOverlay", () => {
  it("accepts a well-formed overlay, with and without a world", () => {
    expect(validateOverlay(valid(), ids)).toEqual({ ok: true, errors: [] });
    expect(validateOverlay(valid()).ok).toBe(true);
  });

  it("rejects an unknown schemaVersion before looking at anything else", () => {
    const result = validateOverlay({ ...valid(), schemaVersion: 2 }, ids);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ path: "schemaVersion", code: "unsupported_schema_version" });
  });

  it("rejects ids and teams that are not in the game world", () => {
    const overlay = valid();
    overlay.players.push({ op: "move", id: "player-ghost", team_id: "lck-team-nope", evidence: "https://lol.fandom.com/wiki/X" });
    expect(codes(overlay)).toEqual(expect.arrayContaining(["unknown_id", "unknown_team"]));
    expect(codes(overlay, false)).toEqual([]);
  });

  it("rejects unknown ops, bad evidence and an id used twice", () => {
    const overlay = valid() as Record<string, any>;
    overlay.players.push({ op: "teleport", id: "x", evidence: "https://lol.fandom.com/wiki/X" });
    overlay.players.push({ op: "retire", id: "player-c5877188", evidence: "not-a-url" });
    expect(codes(overlay)).toEqual(expect.arrayContaining(["unknown_op", "invalid_evidence", "duplicate_id"]));
  });

  it("rejects added records that are malformed or already exist", () => {
    const { record } = generatePlayer({
      page: "Soboro", ign: "Soboro", realName: "Lim Seong-min", country: "South Korea", position: "Top",
      teamId: "lec-fnatic", competition: "lec", infobox: null, baselines: computeBaselines(world),
    });
    const overlay = valid() as Record<string, any>;
    overlay.players = [{ op: "add", player: { ...record, position: "Sixth Man", attributes: { ...record.attributes, laning: 140 } }, evidence: "https://lol.fandom.com/wiki/Fnatic" }];
    expect(codes(overlay)).toEqual(expect.arrayContaining(["invalid_position", "invalid_attribute"]));
    overlay.players = [{ op: "add", player: { ...record, id: "player-c5877188" }, evidence: "https://lol.fandom.com/wiki/Fnatic" }];
    expect(codes(overlay)).toContain("id_exists");
  });

  it("requires license and attribution so the source is always credited", () => {
    const overlay = valid() as Record<string, any>;
    overlay.source.license = "";
    overlay.source.attribution = " ";
    expect(validateOverlay(overlay).errors.map((e) => e.path)).toEqual(expect.arrayContaining(["source.license", "source.attribution"]));
  });

  it("rejects coverage that names unknown competitions and staff moves into protected roles", () => {
    const overlay = valid() as Record<string, any>;
    overlay.coverage = ["lck", "atlantis"];
    overlay.staff = [{ op: "move", id: "staff-62319f46", team_id: null, role: "Owner", evidence: "https://lol.fandom.com/wiki/X" }];
    expect(codes(overlay)).toEqual(expect.arrayContaining(["unknown_competition", "invalid_role"]));
  });

  it("checks the nationality of teamless staff adds as an ISO-2 code or empty", () => {
    const record = generateStaff({ canonicalTitle: "Pad", ign: "Pad", realName: "Patrick Suckow-Breum", country: "DK", role: "HeadCoach", teamId: null, baselines: computeBaselines(world) }).record;
    const staffAdd = (nationality: string) => {
      const overlay = valid() as Record<string, any>;
      overlay.staff = [{ op: "add", staff: { ...record, nationality }, evidence: "https://lol.fandom.com/wiki/Pad" }];
      return codes(overlay);
    };
    expect(staffAdd("DK")).toEqual([]);
    expect(staffAdd("")).toEqual([]);
    expect(staffAdd("Denmark")).toContain("invalid_field");
  });
});
