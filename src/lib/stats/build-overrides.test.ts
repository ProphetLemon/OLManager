// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOverrides, parseArgs, renderReport, runBuild } from "../../../scripts/stats/build-overrides.mjs";
import { ATTRIBUTE_NAMES, calculateLolOvr } from "../../../scripts/stats/lib/game-world.mjs";

const ATTRS = ["mechanics", "laning", "teamfighting", "macro_play", "consistency", "shotcalling", "champion_pool", "discipline", "mental_resilience"];
const attrs = (values: number | number[]) => Object.fromEntries(ATTRS.map((name, i) => [name, Array.isArray(values) ? values[i] : values]));
const pad = (n: number) => String(n).padStart(2, "0");

const GAMES = 14;
/** Rows for one player: stats grow with `quality` (0..1). */
function playerRows(link: string, quality: number, games = GAMES, competition = "lec") {
  return Array.from({ length: games }, (_, g) => ({
    playerKey: link,
    competition,
    role: "Top",
    date: `2026-06-${pad(1 + g)}`,
    gameMinutes: 30,
    kills: Math.round(1 + quality * 6 + (g % 3)),
    deaths: Math.round(5 - quality * 3 + (g % 2)),
    assists: Math.round(3 + quality * 6 + (g % 4)),
    teamKills: 25,
    damageToChampions: Math.round(7000 + quality * 9000 + g * 40),
    teamDamageToChampions: 60000,
    gold: Math.round(9000 + quality * 5000 + g * 20),
    teamGold: 60000,
    cs: Math.round(200 + quality * 80),
    visionScore: 20,
  }));
}

describe("build-overrides end to end", () => {
  let dir: string;
  const write = (file: string, json: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), typeof json === "string" ? json : JSON.stringify(json));
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-overrides-"));
    write("data/competitions/lec/manifest.json", { id: "lec", name: "LEC", teams_file: "teams/lec_teams.json", players_file: "players/lec_players.json" });
    write("data/teams/lec_teams.json", [{ id: "team-a", name: "Team A" }]);
    const players = [];
    const links: Record<string, unknown> = {};
    const rows: unknown[] = [];
    const entryFor = (games: number) => ({
      names: [], teams: [{ team: "Team A", competition: "lec", games, lastDate: "2026-06-14" }], roles: { Top: games }, games, firstDate: "2026-06-01", lastDate: "2026-06-14",
    });
    for (let i = 1; i <= 16; i += 1) {
      const name = `Top${pad(i)}`;
      players.push({ id: `p-${name}`, match_name: name, full_name: name, team_id: "team-a", position: "Top", attributes: attrs(60 + (i % 8)), potential_base: 66 + (i % 8), market_value: 1, wage: 1 });
      links[name] = { ...entryFor(GAMES), names: [name] };
      rows.push(...playerRows(name, i / 16));
    }
    players.push({ id: "p-boal", match_name: "Boal", full_name: "Boal", team_id: "team-a", position: "Top", attributes: attrs([46, 53, 48, 51, 49, 50, 52, 47, 50]), potential_base: 55, market_value: 1, wage: 1 });
    links["Boal (Brazilian Player)"] = { ...entryFor(GAMES), names: ["Boal"] };
    rows.push(...playerRows("Boal (Brazilian Player)", 1.1));
    players.push({ id: "p-rookie", match_name: "Rookie", full_name: "Rookie", team_id: "team-a", position: "Top", attributes: attrs(61), potential_base: 70, market_value: 1, wage: 1 });
    links.Rookie = { ...entryFor(3), names: ["Rookie"] };
    rows.push(...playerRows("Rookie", 0.9, 3));
    players.push({ id: "p-flat", match_name: "Flat", full_name: "Flat", team_id: "team-a", position: "Top", attributes: attrs(50), potential_base: 50, market_value: 1, wage: 1 });
    links.Flat = { ...entryFor(GAMES), names: ["Flat"] };
    rows.push(...playerRows("Flat", 0.95));
    players.push({ id: "p-nostats", match_name: "NoStats", full_name: "NoStats", team_id: "team-a", position: "Top", attributes: attrs(62), potential_base: 70, market_value: 1, wage: 1 });
    links.Stranger = { ...entryFor(40), names: ["Stranger"] };
    write("data/players/lec_players.json", players);
    write("team-map.json", { schemaVersion: 1, teams: { "lec-team-a": { title: "Team A", name: "Team A", competition: "lec" } } });
    write("pins.json", "{}\n");
    write("scratch/rows.json", { source: "test", since: "2025-01-01", until: "2026-11-10", competitions: ["lec"], rows });
    write("scratch/rows.players.json", { source: "test", since: "2025-01-01", until: "2026-11-10", players: links });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const args = (extra: string[] = [], out = "out/overrides.json") =>
    parseArgs([
      "--rows", path.join(dir, "scratch/rows.json"), "--data", path.join(dir, "data"), "--overlay", path.join(dir, "no-overlay.json"),
      "--team-map", path.join(dir, "team-map.json"), "--pins", path.join(dir, "pins.json"),
      "--out", path.join(dir, out), "--report-dir", path.join(dir, path.dirname(out)), ...extra,
    ]);
  const readAsset = (out = "out/overrides.json") => JSON.parse(fs.readFileSync(path.join(dir, out), "utf8"));

  it("writes the asset with exactly the contract shape", async () => {
    runBuild(args(), () => {});
    const asset = readAsset();
    expect(Object.keys(asset)).toEqual(["version", "method", "source", "window", "league_levels", "entries"]);
    expect(asset.version).toBe(1);
    expect(asset.method).toBe("stat-blend-v1");
    expect(asset.source).toBe("Leaguepedia ScoreboardPlayers and ScoreboardGames (lol.fandom.com), CC BY-SA 3.0");
    expect(asset.window).toEqual({ since: "2025-01-01", until: "2026-11-10" });
    expect(Object.keys(asset.league_levels)).toEqual(["lec"]);
    expect(Object.keys(asset.league_levels.lec)).toEqual(["median", "sd"]);
    expect(asset.entries.length).toBeGreaterThan(5);

    const ids = asset.entries.map((e: { id: string }) => e.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of asset.entries) {
      expect(Object.keys(entry)).toEqual(["id", "authored_ovr", "games", "confidence", "attributes", "potential_floor"]);
      expect(Number.isInteger(entry.authored_ovr) && entry.authored_ovr >= 1 && entry.authored_ovr <= 99).toBe(true);
      expect(Number.isInteger(entry.games) && entry.games > 0).toBe(true);
      expect(entry.confidence).toBeGreaterThan(0);
      expect(entry.confidence).toBeLessThanOrEqual(1);
      expect(Object.keys(entry.attributes)).toEqual(ATTRIBUTE_NAMES);
      for (const v of Object.values(entry.attributes) as number[]) expect(Number.isInteger(v) && v >= 1 && v <= 99).toBe(true);
      expect(Number.isInteger(entry.potential_floor) && entry.potential_floor >= 1 && entry.potential_floor <= 99).toBe(true);
      expect(entry.potential_floor).toBeGreaterThanOrEqual(calculateLolOvr(entry.attributes));
    }
  });

  it("is byte-identical across runs and formatted as 2-space JSON with a trailing newline", async () => {
    runBuild(args([], "a/overrides.json"), () => {});
    runBuild(args([], "b/overrides.json"), () => {});
    const a = fs.readFileSync(path.join(dir, "a/overrides.json"), "utf8");
    expect(a).toBe(fs.readFileSync(path.join(dir, "b/overrides.json"), "utf8"));
    expect(a.endsWith("}\n")).toBe(true);
    expect(a).toBe(`${JSON.stringify(JSON.parse(a), null, 2)}\n`);
  });

  it("lifts a suspect low-rated player whose stats are the best, and leaves out thin, placeholder and unmatched players", async () => {
    runBuild(args(), () => {});
    const byId = new Map(readAsset().entries.map((e: { id: string }) => [e.id, e]));
    const boal = byId.get("p-boal") as { authored_ovr: number; attributes: Record<string, number>; confidence: number; potential_floor: number };
    expect(boal.authored_ovr).toBe(50);
    expect(calculateLolOvr(boal.attributes)).toBeGreaterThan(55);
    expect(boal.confidence).toBeGreaterThan(0.3);
    expect(boal.potential_floor).toBeGreaterThanOrEqual(calculateLolOvr(boal.attributes));
    expect(byId.has("p-rookie")).toBe(false);
    expect(byId.has("p-flat")).toBe(false);
    expect(byId.has("p-nostats")).toBe(false);
  });

  it("can include placeholder rows on request", async () => {
    runBuild(args(["--include-placeholders"]), () => {});
    const flat = readAsset().entries.find((e: { id: string }) => e.id === "p-flat");
    expect(flat.authored_ovr).toBe(50);
    expect(calculateLolOvr(flat.attributes)).toBeGreaterThan(50);
  });

  it("writes report.json and report.md with the per-competition numbers and the named players", async () => {
    runBuild(args(), () => {});
    const report = JSON.parse(fs.readFileSync(path.join(dir, "out/report.json"), "utf8"));
    const lec = report.competitions.find((c: { competition: string }) => c.competition === "lec");
    expect(lec).toMatchObject({ players: 20, matched: 19 });
    expect(lec.estimated).toBeGreaterThanOrEqual(readAsset().entries.length);
    expect(lec.maxAbsDelta).toBeGreaterThanOrEqual(lec.meanAbsDelta);
    expect(report.thresholds.map((t: { ovr: number }) => t.ovr)).toEqual([65, 70, 80]);
    expect(report.risers[0].matchName).toBe("Boal");
    expect(report.suspects.map((s: { id: string }) => s.id)).toContain("p-boal");
    expect(report.unmatched[0]).toMatchObject({ link: "Stranger", games: 40 });
    expect(report.spotlight.map((s: { query: string; found: boolean }) => [s.query, s.found])).toEqual([["Boal", true], ["Minous", false], ["Winner", false]]);
    const md = fs.readFileSync(path.join(dir, "out/report.md"), "utf8");
    expect(md).toContain("# Stat-based ratings: before and after");
    expect(md).toContain("Boal");
    expect(md).toContain("lec");
  });

  it("keeps a pinned-never link out and reports it", async () => {
    write("pins.json", JSON.stringify({ Top01: null }));
    runBuild(args(), () => {});
    expect(readAsset().entries.some((e: { id: string }) => e.id === "p-Top01")).toBe(false);
  });
});

describe("buildOverrides", () => {
  it("returns an empty entry list for no rows", () => {
    const { asset } = buildOverrides({ rows: [], window: { since: "2025-01-01", until: "2026-01-01" }, index: {}, players: [], teamMap: { teams: {} }, pins: {} });
    expect(asset.entries).toEqual([]);
    expect(asset.league_levels).toEqual({});
  });
  it("renders a report without entries", () => {
    const { report } = buildOverrides({ rows: [], window: { since: "2025-01-01", until: "2026-01-01" }, index: {}, players: [], teamMap: { teams: {} }, pins: {} });
    expect(renderReport(report)).toContain("# Stat-based ratings");
  });
});
