// @vitest-environment node
// Overlay compatibility gate (A6e): an overlay with teamless pool adds is schemaVersion 2, because installed apps
// (2026.1114.1) reject any version but 1 at parse and so keep their rosters instead of putting pool pros on AI teams.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeBaselines, generateStaff } from "../../../scripts/world/lib/generate.mjs";
import { OFFLINE_LICENSE, buildOverlay } from "../../../scripts/world/lib/overlay.mjs";
import { validateOverlay } from "../../../scripts/world/lib/overlay-schema.mjs";
import { generateKeypair } from "../../../scripts/world/lib/signing.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";
import { root } from "./poolFixtures";

const world = loadWorld(FIXTURES.dataDir);
const evidence = "https://lol.fandom.com/wiki/Pad";
const staffRecord = (teamId: string | null) =>
  generateStaff({ canonicalTitle: "Pad", ign: "Pad", realName: "Patrick Suckow-Breum", country: "DK", role: "HeadCoach", teamId, baselines: computeBaselines(world) }).record;
const teamlessAdd = () => ({ op: { op: "add", staff: staffRecord(null), evidence } });
const teamedAdd = () => ({ op: { op: "add", staff: staffRecord("lec-fnatic"), evidence } });
const move = () => ({ op: { op: "move", id: "player-c5877188", team_id: "lck-team-bc4c40ec", evidence } });
const retire = () => ({ op: { op: "retire", id: "lec-player-105501834624360050", evidence } });
const build = (players: object[], staff: object[]) => buildOverlay({ asOf: "2026-11-07", license: OFFLINE_LICENSE, coverage: ["lck"], players: players as never, staff: staff as never });
const playerAdd = (teamId: string | null) => ({ op: { op: "add", player: { id: "player-new", team_id: teamId }, evidence } });

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "olm-version-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("overlay emitter", () => {
  it("emits schemaVersion 2 when the overlay has a teamless staff add", () => {
    expect(build([], [teamlessAdd()]).schemaVersion).toBe(2);
  });

  it("emits schemaVersion 2 when the overlay has a teamless player add", () => {
    expect(build([playerAdd(null)], []).schemaVersion).toBe(2);
  });

  it("emits schemaVersion 1 when every add has a team and the rest are moves and retirements", () => {
    expect(build([move(), retire(), playerAdd("lck-team-bc4c40ec")], [teamedAdd()]).schemaVersion).toBe(1);
  });

  it("emits schemaVersion 1 for an overlay with no ops at all", () => {
    expect(build([], []).schemaVersion).toBe(1);
  });
});

describe("validateOverlay schema versions", () => {
  const overlayWith = (schemaVersion: number, staff: object[]) => ({ ...build([move()], staff), schemaVersion });
  const codes = (overlay: unknown) => validateOverlay(overlay).errors.map((e) => e.code);

  it("accepts schemaVersion 2 with a teamless add", () => {
    expect(validateOverlay(overlayWith(2, [teamlessAdd()]))).toEqual({ ok: true, errors: [] });
  });

  it("accepts schemaVersion 1 with no teamless adds", () => {
    expect(validateOverlay(overlayWith(1, [teamedAdd()]))).toEqual({ ok: true, errors: [] });
  });

  it("rejects schemaVersion 1 with a teamless add", () => {
    expect(codes(overlayWith(1, [teamlessAdd()]))).toEqual(["teamless_adds_need_schema_v2"]);
  });

  it("rejects schemaVersion 3 as unsupported", () => {
    expect(codes(overlayWith(3, []))).toEqual(["unsupported_schema_version"]);
  });
});

describe("world:sign and verify:world-overlay", () => {
  const run = (script: string, args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [path.join(root, "scripts/world", script), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  const writeOverlay = (schemaVersion: number, staff: object[]) => {
    const file = path.join(tmp(), "overlay.json");
    fs.writeFileSync(file, `${JSON.stringify({ ...build([], staff), schemaVersion }, null, 2)}\n`);
    return file;
  };
  const keyEnv = () => {
    const keyPath = path.join(tmp(), "key.pem");
    generateKeypair(keyPath);
    return { OLM_OVERLAY_SIGNING_KEY: keyPath };
  };

  it("sign refuses a version 1 file with teamless adds and writes no signature", () => {
    const file = writeOverlay(1, [teamlessAdd()]);
    const result = run("sign.mjs", [file], keyEnv());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("teamless_adds_need_schema_v2");
    expect(fs.existsSync(`${file}.sig`)).toBe(false);
  });

  it("sign signs a version 2 file with teamless adds", () => {
    const file = writeOverlay(2, [teamlessAdd()]);
    run("sign.mjs", [file], keyEnv());
    expect(fs.existsSync(`${file}.sig`)).toBe(true);
  });

  it("verify-overlay refuses a version 1 file with teamless adds", () => {
    const file = writeOverlay(1, [teamlessAdd()]);
    const result = run("verify-overlay.mjs", [file, FIXTURES.dataDir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("teamless_adds_need_schema_v2");
  });

  it("verify-overlay passes the schema check for a version 2 file with teamless adds", () => {
    const file = writeOverlay(2, [teamlessAdd()]);
    const result = run("verify-overlay.mjs", [file, FIXTURES.dataDir]);
    expect(result.stderr).not.toContain("teamless_adds_need_schema_v2");
  });
});
