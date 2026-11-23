// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DUAL_ROLES, loadGateExceptions, playerStaffTwins, runGates, simulateRosterCounts } from "../../../scripts/world/lib/gates.mjs";
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

  describe("max-adds-per-team with teamless adds (the active-pros pool)", () => {
    const team = "lck-team-bc4c40ec";
    const add = (n: number, teamId: string | null) => ({ op: "add", player: { id: `player-add${String(n).padStart(5, "0")}`, team_id: teamId }, evidence });
    const adds = (count: number, teamId: string | null, from = 0) => Array.from({ length: count }, (_, i) => add(from + i, teamId));
    const maxAdds = (overlay: unknown[]) => gate(runGates({ overlay: overlayOf(overlay), world, coveredTeamIds: covered }), "max-adds-per-team");

    it("lets a team gain exactly the maximum while many free agents are added next to it", () => {
      expect(maxAdds([...adds(8, team), ...adds(500, null, 100)])).toMatchObject({ ok: true });
    });

    it("still fails a team that gains one more than the maximum, whatever the free agents are", () => {
      const result = maxAdds([...adds(9, team), ...adds(500, null, 100)]);
      expect(result).toMatchObject({ ok: false });
      expect(result.detail).toContain(`${team} +9`);
    });

    it("never counts teamless adds against a team, however many there are", () => {
      expect(maxAdds(adds(5000, null))).toMatchObject({ ok: true });
    });

    it("counts only the adds of the team, not those of another team", () => {
      expect(maxAdds([...adds(8, team), ...adds(8, "lck-team-932ee946", 100), ...adds(40, null, 200)])).toMatchObject({ ok: true });
    });
  });

  it("passes a shortfall caused only by confirmed moves and lists the team", () => {
    const roster = teams("lck-team-bc4c40ec");
    const overlay = overlayOf(roster.slice(0, roster.length - 4).map((p) => ({ op: "move", id: p.id, team_id: "lck-team-932ee946", evidence })));
    const result = runGates({ overlay, world, coveredTeamIds: covered, options: { maxChangedShare: 1 } });
    expect(gate(result, "min-roster").ok).toBe(true);
    expect(gate(result, "min-roster").detail).toContain("short only through confirmed moves/retirements; the game fills them from free agents at new game");
    expect(gate(result, "min-roster").detail).toContain("lck-team-bc4c40ec");
  });

  it("fails when a release out of a short team is still in the overlay", () => {
    const roster = teams("lck-team-bc4c40ec");
    const [released, ...moved] = roster.slice(0, roster.length - 4);
    const overlay = overlayOf([
      { op: "move", id: released.id, team_id: null, evidence },
      ...moved.map((p) => ({ op: "move", id: p.id, team_id: "lck-team-932ee946", evidence })),
    ]);
    const result = runGates({ overlay, world, coveredTeamIds: covered, options: { maxChangedShare: 1 } });
    expect(gate(result, "min-roster").ok).toBe(false);
  });

  describe("max-changed-share reviewed exceptions", () => {
    const lck = world.players.filter((p) => p.competition === "lck");
    const overlay = overlayOf(lck.map((p) => ({ op: "retire", id: p.id, evidence })));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-exceptions-"));
    const write = (content: unknown) => {
      const file = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify(content));
      return file;
    };

    it("passes a listed competition and quotes the reason", () => {
      const gateExceptions = loadGateExceptions(write({ maxChangedShare: { lck: { reason: "reviewed: evidence-backed", reviewed: "2026-11-07" } } }));
      const result = runGates({ overlay, world, coveredTeamIds: covered, options: { minRosterSize: 0 }, gateExceptions });
      expect(gate(result, "max-changed-share").ok).toBe(true);
      expect(gate(result, "max-changed-share").detail).toContain("reviewed exception: reviewed: evidence-backed");
    });

    it("treats a missing file as no exceptions", () => {
      const gateExceptions = loadGateExceptions(path.join(dir, "absent.json"));
      expect(gate(runGates({ overlay, world, coveredTeamIds: covered, options: { minRosterSize: 0 }, gateExceptions }), "max-changed-share").ok).toBe(false);
    });

    it("rejects entries without a reason or a reviewed date", () => {
      expect(() => loadGateExceptions(write({ maxChangedShare: { lck: { reviewed: "2026-11-07" } } }))).toThrow(/lck needs a non-empty reason/);
      expect(() => loadGateExceptions(write({ maxChangedShare: { lck: { reason: "x" } } }))).toThrow(/lck needs a reviewed date/);
      expect(() => loadGateExceptions(write({ maxChangedShare: { lck: { reason: "x", reviewed: "yesterday" } } }))).toThrow(/reviewed date/);
    });
  });
});

describe("no-player-staff-twins: one person both a player and a staff member", () => {
  type Rec = Record<string, unknown>;
  const asPlayer = (id: string, extra: Rec = {}) => ({ op: "add", player: { id, match_name: "Someone", full_name: "Some One", date_of_birth: "2001-01-01", nationality: "FR", position: "Mid", team_id: null, ...extra }, evidence });
  const asStaff = (id: string, extra: Rec = {}, op: Rec = {}) => ({ op: "add", staff: { id, nickname: "Someone", first_name: "Some One", last_name: "One", date_of_birth: "2001-01-01", nationality: "FR", role: "HeadCoach", team_id: "lck-team-bc4c40ec", ...extra }, evidence, ...op });
  const empty = { players: [], staff: [] };
  const twins = (overlay: { players?: unknown[]; staff?: unknown[] }, extra: { pages?: Map<string, string>; allowed?: { player: string; staff: string }[]; world?: { players: Rec[]; staff: Rec[] } } = {}) =>
    playerStaffTwins({ overlay, world: extra.world ?? empty, pages: extra.pages, allowed: extra.allowed ?? [] });

  it("finds a player and a staff member made from one Leaguepedia page (the same page hash)", () => {
    const found = twins({ players: [asPlayer("player-1234abcd", { date_of_birth: "2002-01-01" })], staff: [asStaff("staff-1234abcd", { date_of_birth: "1990-01-01" })] });
    expect(found).toEqual([{ player: "player-1234abcd", staff: "staff-1234abcd", rule: "same-page" }]);
  });

  it("finds one page spelled two ways through the page titles the run knows", () => {
    const overlay = { players: [asPlayer("player-aaaaaaaa", { date_of_birth: "2002-01-01" })], staff: [asStaff("staff-bbbbbbbb", {}, { dob_approx: true })] };
    expect(twins(overlay)).toEqual([]);
    const pages = new Map([["player-aaaaaaaa", "AkaRyu"], ["staff-bbbbbbbb", "Akaryu"]]);
    expect(twins(overlay, { pages })).toEqual([{ player: "player-aaaaaaaa", staff: "staff-bbbbbbbb", rule: "same-page" }]);
  });

  it("finds a shared folded name with the same real birth date, whatever the ids", () => {
    const overlay = { players: [asPlayer("player-aaaaaaaa", { match_name: "AkaRyu", full_name: "Bourekda Abdelhai", date_of_birth: "1999-11-11" })], staff: [asStaff("staff-bbbbbbbb", { nickname: "Akaryu", first_name: "Bourekda Abdelhai", last_name: "Abdelhai", date_of_birth: "1999-11-11" })] };
    expect(twins(overlay)).toEqual([{ player: "player-aaaaaaaa", staff: "staff-bbbbbbbb", rule: "name-and-birth-date" }]);
  });

  it("does not take a guessed or placeholder birth date, or another birth date, as identity", () => {
    const player = asPlayer("player-aaaaaaaa");
    expect(twins({ players: [player], staff: [asStaff("staff-bbbbbbbb", {}, { dob_approx: true })] })).toEqual([]);
    expect(twins({ players: [asPlayer("player-aaaaaaaa", { date_of_birth: "1990-01-01" })], staff: [asStaff("staff-bbbbbbbb", { date_of_birth: "1990-01-01" })] })).toEqual([]);
    expect(twins({ players: [asPlayer("player-aaaaaaaa", { date_of_birth: "2002-01-01" })], staff: [asStaff("staff-bbbbbbbb", { date_of_birth: "2002-01-01" })] })).toEqual([]);
    expect(twins({ players: [player], staff: [asStaff("staff-bbbbbbbb", { date_of_birth: "2001-01-02" })] })).toEqual([]);
  });

  it("reads the world after the ops: a retired player is no longer anybody's twin", () => {
    const world = { players: [{ id: "player-1234abcd", match_name: "Someone", full_name: "Some One", date_of_birth: "2001-01-01" }], staff: [] };
    const staff = [asStaff("staff-1234abcd")];
    expect(twins({ players: [], staff }, { world })).toHaveLength(1);
    expect(twins({ players: [{ op: "retire", id: "player-1234abcd", evidence }], staff }, { world })).toEqual([]);
  });

  it("leaves out a reviewed dual role, and every reviewed one is a page-hash pair", () => {
    const overlay = { players: [asPlayer("player-1234abcd")], staff: [asStaff("staff-1234abcd")] };
    expect(twins(overlay, { allowed: [{ player: "player-1234abcd", staff: "staff-1234abcd" }] })).toEqual([]);
    for (const role of DUAL_ROLES) expect(role.player.slice("player-".length)).toBe(role.staff.slice("staff-".length));
  });

  it("fails the run and names the pair; an overlay without twins passes", () => {
    const overlay = { ...overlayOf([asPlayer("player-1234abcd")]), staff: [asStaff("staff-1234abcd")] };
    const failed = gate(runGates({ overlay, world, coveredTeamIds: covered }), "no-player-staff-twins");
    expect(failed).toMatchObject({ ok: false, value: { twins: 1 } });
    expect(failed.detail).toContain("player-1234abcd ~ staff-1234abcd (same-page)");
    expect(gate(runGates({ overlay: overlayOf([]), world, coveredTeamIds: covered }), "no-player-staff-twins").ok).toBe(true);
  });
});
