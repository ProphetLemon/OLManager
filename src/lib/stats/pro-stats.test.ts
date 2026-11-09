// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaWikiClient, OfflineCacheMissError } from "../../../scripts/world/lib/mediawiki-client.mjs";
import { coveragePath, defaultUntil, fetchCompetitionRows, loadPrefixMap, parseArgs, runProStats } from "../../../scripts/stats/pro-stats.mjs";
import type { PrefixMap } from "../../../scripts/stats/pro-stats.mjs";

const map: PrefixMap = { version: 1, competitions: { lec: ["LEC/"], lck: ["LCK/"] }, open: { "LTA North": "unconfirmed" } };

const title = (gameId: string, team: string, role: string, side: number) => ({
  OverviewPage: "LEC/2025 Season/Winter Season",
  GameId: gameId,
  Link: `${team}-${role}`,
  Name: `${team}-${role}`,
  Team: team,
  Role: role,
  Side: String(side),
  Kills: "3",
  Deaths: "2",
  Assists: "4",
  Gold: "12000",
  CS: "250",
  DamageToChampions: "15000",
  VisionScore: "20",
  TeamKills: "12",
  TeamGold: "55000",
  DateTimeUtc: "2025-02-01 12:00:00",
  GameMinutes: "30.2",
});
const gameTitles = (gameId: string) =>
  [[1, "G2"], [2, "FNC"]].flatMap(([side, team]) => ["Top", "Jungle", "Mid", "Bot", "Support"].map((role) => title(gameId, team as string, role, side as number)));

const answer = (titles: Record<string, string>[]) => ({ cargoquery: titles.map((t) => ({ title: t })) });

describe("fetchCompetitionRows", () => {
  it("pages with growing offsets and stops at the first short page", async () => {
    const pages = [gameTitles("g1"), gameTitles("g2"), gameTitles("g3").slice(0, 4)];
    const get = vi.fn(async (_params: Record<string, string>) => answer(pages[get.mock.calls.length - 1]));
    const rows = await fetchCompetitionRows({ get } as never, { prefixes: ["LEC/"], since: "2025-01-01", until: "2027-01-01", pageSize: 10 });
    expect(get.mock.calls.map(([p]) => p.offset)).toEqual(["0", "10", "20"]);
    expect(get.mock.calls.every(([p]) => p.limit === "10")).toBe(true);
    expect(rows).toHaveLength(24);
  });

  it("issues one request for an empty first page", async () => {
    const get = vi.fn(async () => answer([]));
    expect(await fetchCompetitionRows({ get } as never, { prefixes: ["LEC/"], since: "2025-01-01", until: "2027-01-01", pageSize: 10 })).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("fails clearly on an offline cache miss", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pro-stats-offline-"));
    try {
      const client = new MediaWikiClient({ cacheDir: dir, offline: true });
      const run = fetchCompetitionRows(client, { prefixes: ["LEC/"], since: "2025-01-01", until: "2027-01-01", pageSize: 10 });
      await expect(run).rejects.toBeInstanceOf(OfflineCacheMissError);
      await expect(run).rejects.toThrow(/offline mode: no cached response/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseArgs", () => {
  it("applies the documented defaults", () => {
    const args = parseArgs([], map, new Date("2026-11-09T10:00:00Z"));
    expect(args).toMatchObject({ since: "2025-01-01", until: "2026-11-10", offline: false, login: false, maxRequests: 450, pageSize: 500 });
    expect(args.competitions).toEqual(["lck", "lec"]);
    expect(args.cacheDir.endsWith(path.join("src-tauri/target/olm-scratch/lp-stats-cache"))).toBe(true);
    expect(args.cacheDir.includes("lp-cargo-cache")).toBe(false);
    expect(args.out.endsWith(path.join("src-tauri/target/olm-scratch/stat-ratings/rows.json"))).toBe(true);
  });

  it("parses flags and validates them", () => {
    const args = parseArgs(["--competitions", "lec,lec", "--offline", "--login", "--since", "2025-06-01", "--max-requests", "5", "--page-size", "100"], map);
    expect(args).toMatchObject({ competitions: ["lec"], offline: true, login: true, since: "2025-06-01", maxRequests: 5, pageSize: 100 });
    expect(() => parseArgs(["--competitions", "lta-north"], map)).toThrow(/unmapped competition/);
    expect(() => parseArgs(["--since", "2024-13-45"], map)).toThrow(/--since/);
    expect(() => parseArgs(["--since", "2027-01-01"], map)).toThrow(/earlier/);
    expect(() => parseArgs(["--page-size", "0"], map)).toThrow(/--page-size/);
    expect(() => parseArgs(["--max-requests", "x"], map)).toThrow(/--max-requests/);
    expect(() => parseArgs(["--page-size", "501"], map)).toThrow(/needs --login/);
    expect(parseArgs(["--page-size", "500"], map).pageSize).toBe(500);
    expect(parseArgs(["--login", "--page-size", "5000"], map).pageSize).toBe(5000);
    expect(() => parseArgs(["--bogus"], map)).toThrow(/unknown flag/);
    expect(() => parseArgs(["--out"], map)).toThrow(/needs a value/);
    expect(parseArgs(["--help"], map).help).toBe(true);
  });
});

describe("defaultUntil", () => {
  it("is tomorrow in UTC, capped at 2027-01-01", () => {
    expect(defaultUntil(new Date("2026-11-09T23:30:00Z"))).toBe("2026-11-10");
    expect(defaultUntil(new Date("2026-12-31T00:00:00Z"))).toBe("2027-01-01");
    expect(defaultUntil(new Date("2028-03-01T00:00:00Z"))).toBe("2027-01-01");
  });
});

describe("runProStats", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pro-stats-run-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes normalized rows and a coverage report per competition", async () => {
    const get = vi.fn(async (params: Record<string, string>) => {
      const lec = params.where.includes("'LEC/%'");
      if (!lec) return answer([]);
      return answer([...gameTitles("g1"), ...gameTitles("g2").slice(0, 9)]);
    });
    const out = path.join(dir, "nested/rows.json");
    const args = { ...parseArgs(["--competitions", "lec,lck", "--out", out], map), pageSize: 500 };
    const logs: string[] = [];
    const { rows, coverage } = await runProStats(args, { get, stats: { network: 0, cacheHits: 0, retries: 0, retryReasons: {} } } as never, (m) => logs.push(m), map);

    expect(get).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(15);
    expect(coverage.competitions.lec).toEqual({
      games: 2,
      rows: 15,
      players: 10,
      inputRows: 19,
      dropped: { "team without exactly 5 rows": 4 },
    });
    expect(coverage.competitions.lck).toMatchObject({ games: 0, rows: 0, players: 0, dropped: {} });
    expect(coverage.open).toEqual({ "LTA North": "unconfirmed" });

    const written = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(written.rows).toHaveLength(15);
    expect(written.rows[0].competition).toBe("lec");
    expect(written.source).toMatch(/CC BY-SA 3.0/);
    expect(JSON.parse(fs.readFileSync(coveragePath(out), "utf8")).totals).toEqual({ rows: 15, games: 2, inputRows: 19 });
    expect(logs.some((m) => m.includes("lec:"))).toBe(true);
  });

  it("derives the coverage path next to the output", () => {
    expect(coveragePath("/x/rows.json")).toBe("/x/rows.coverage.json");
    expect(coveragePath("/x/rows")).toBe("/x/rows.coverage.json");
  });
});

describe("prefix-map.json", () => {
  const prefixMap = loadPrefixMap();
  const teamMap = JSON.parse(fs.readFileSync("scripts/world/team-map.json", "utf8")) as { teams: Record<string, { competition: string }> };
  const overrides = JSON.parse(fs.readFileSync("assets/world/competition-overrides.json", "utf8")) as { competitions: Record<string, unknown> };
  const knownIds = new Set([...Object.values(teamMap.teams).map((t) => t.competition), ...Object.keys(overrides.competitions)]);

  it("only maps known competition ids", () => {
    for (const id of Object.keys(prefixMap.competitions)) expect(knownIds.has(id), id).toBe(true);
  });

  it("never lists a prefix under two competitions, nor a prefix that shadows another", () => {
    const all = Object.entries(prefixMap.competitions).flatMap(([id, prefixes]) => prefixes.map((p) => [p, id] as const));
    expect(new Set(all.map(([p]) => p)).size).toBe(all.length);
    for (const [a, idA] of all) for (const [b, idB] of all) if (a !== b && b.startsWith(a)) expect.soft(idA, `${a} shadows ${b}`).toBe(idB);
  });

  it("uses only valid, slash-terminated prefixes", async () => {
    const { assertValidPrefix } = await import("../../../scripts/stats/lib/queries.mjs");
    for (const prefixes of Object.values(prefixMap.competitions)) {
      expect(prefixes.length).toBeGreaterThan(0);
      for (const prefix of prefixes) {
        expect(() => assertValidPrefix(prefix)).not.toThrow();
        expect(prefix.endsWith("/")).toBe(true);
      }
    }
  });

  it("keeps the unconfirmed names open and unmapped", () => {
    const mapped = Object.values(prefixMap.competitions).flat().join("|");
    for (const name of ["LCK Academy Series", "Equal Esports Cup 2025", "Equal Esports Cup 2026"]) {
      expect(prefixMap.open?.[name], name).toMatch(/\S/);
      expect(mapped.includes(name), name).toBe(false);
    }
    expect(prefixMap.competitions.eec).toBeUndefined();
  });

  it("maps the 2025 predecessors the user confirmed", () => {
    expect(prefixMap.competitions.les).toEqual(["LES/", "Superliga Domino's/"]);
    expect(prefixMap.competitions.lcs).toEqual(["LCS/", "LTA North/"]);
    expect(prefixMap.competitions.cblol).toEqual(["CBLOL/", "LTA South/"]);
    for (const name of ["Superliga Domino's", "LTA North", "LTA South"]) {
      expect(prefixMap.open?.[name], name).toBeUndefined();
    }
  });
});
