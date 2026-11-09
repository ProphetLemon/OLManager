// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergePlayerIndexes, normalizeRows } from "../../../scripts/stats/lib/normalize.mjs";
import type { RawRow } from "../../../scripts/stats/lib/queries.mjs";
import { parseArgs, playersPath, runProStats } from "../../../scripts/stats/pro-stats.mjs";
import type { PrefixMap } from "../../../scripts/stats/pro-stats.mjs";

const ROLES = ["Top", "Jungle", "Mid", "Bot", "Support"];

/** One complete game: `blue` and `red` are team names, links are `<team>-<role>` unless overridden. */
function game(gameId: string, date: string, blue: string, red: string, patch: (row: RawRow) => RawRow = (r) => r): RawRow[] {
  const rows: RawRow[] = [];
  for (const [side, team] of [[1, blue], [2, red]] as const) {
    ROLES.forEach((role, i) => {
      rows.push(
        patch({
          overviewPage: "LEC/2025 Season/Winter Season",
          gameId,
          link: `${team}-${role}`,
          name: `${team}-${role}`,
          team,
          role,
          side,
          kills: 3,
          deaths: 2,
          assists: 4,
          gold: 12000,
          cs: 250,
          damageToChampions: 10000 + i * 1000,
          visionScore: 20,
          teamKills: 12,
          teamGold: 55000,
          dateTime: `${date} 12:00:00`,
          gameMinutes: 30,
        }),
      );
    });
  }
  return rows;
}

describe("player index from normalizeRows", () => {
  it("indexes each Leaguepedia link with names, teams, roles, games and dates", () => {
    const rows = [
      ...game("g1", "2025-02-01", "G2", "FNC", (r) => (r.role === "Mid" && r.team === "G2" ? { ...r, link: "Caps", name: "Caps" } : r)),
      ...game("g2", "2025-03-01", "G2", "FNC", (r) => (r.role === "Mid" && r.team === "G2" ? { ...r, link: "Caps", name: "CAPS" } : r)),
      ...game("g3", "2025-04-01", "FNC", "G2", (r) => (r.role === "Mid" && r.team === "G2" ? { ...r, link: "Caps", name: "Caps", role: "Support" } : r.role === "Support" && r.team === "G2" ? { ...r, role: "Mid" } : r)),
    ];
    const { index } = normalizeRows(rows, { competition: "lec" });
    expect(index.Caps).toEqual({
      names: ["CAPS", "Caps"],
      teams: [{ team: "G2", competition: "lec", games: 3, lastDate: "2025-04-01" }],
      roles: { Mid: 2, Support: 1 },
      games: 3,
      firstDate: "2025-02-01",
      lastDate: "2025-04-01",
    });
    expect(Object.keys(index)).toEqual([...Object.keys(index)].sort());
  });

  it("is independent of the input order and ignores dropped rows", () => {
    const rows = [...game("g1", "2025-02-01", "G2", "FNC"), ...game("g2", "2025-03-01", "G2", "FNC").slice(0, 9)];
    const a = normalizeRows(rows, { competition: "lec" });
    const b = normalizeRows([...rows].reverse(), { competition: "lec" });
    expect(JSON.stringify(b.index)).toBe(JSON.stringify(a.index));
    expect(a.index["G2-Top"].games).toBe(2);
    expect(a.index["FNC-Top"].games).toBe(1);
  });
});

describe("mergePlayerIndexes", () => {
  it("adds up one link seen in several competitions and orders teams by recency", () => {
    const lec = normalizeRows(game("g1", "2025-02-01", "G2", "FNC"), { competition: "lec" }).index;
    const lfl = normalizeRows(game("g2", "2025-05-01", "G2", "FNC", (r) => (r.team === "G2" ? { ...r, team: "G2 Academy" } : r)), { competition: "lfl" }).index;
    const merged = mergePlayerIndexes([lec, lfl]);
    const entry = merged["G2-Top"];
    expect(entry.games).toBe(2);
    expect(entry.firstDate).toBe("2025-02-01");
    expect(entry.lastDate).toBe("2025-05-01");
    expect(entry.teams.map((t: { team: string; competition: string }) => `${t.team}@${t.competition}`)).toEqual(["G2 Academy@lfl", "G2@lec"]);
    expect(entry.roles).toEqual({ Top: 2 });
  });
});

describe("runProStats writes the index", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "players-index-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("derives the path next to the rows file", () => {
    expect(playersPath("/x/rows.json")).toBe("/x/rows.players.json");
    expect(playersPath("/x/rows")).toBe("/x/rows.players.json");
  });

  it("writes <out>.players.json merged across competitions", async () => {
    const map: PrefixMap = { version: 1, competitions: { lec: ["LEC/"], lck: ["LCK/"] } };
    const toCargo = (rows: RawRow[]) => ({
      cargoquery: rows.map((r) => ({
        title: {
          OverviewPage: r.overviewPage, GameId: r.gameId, Link: r.link, Name: r.name, Team: r.team, Role: r.role, Side: String(r.side),
          Kills: String(r.kills), Deaths: String(r.deaths), Assists: String(r.assists), Gold: String(r.gold), CS: String(r.cs),
          DamageToChampions: String(r.damageToChampions), VisionScore: String(r.visionScore), TeamKills: String(r.teamKills),
          TeamGold: String(r.teamGold), DateTimeUtc: r.dateTime, GameMinutes: String(r.gameMinutes),
        },
      })),
    });
    const get = vi.fn(async (params: Record<string, string>) =>
      toCargo(params.where.includes("'LEC/%'") ? game("g1", "2025-02-01", "G2", "FNC") : game("g2", "2025-03-01", "DK", "T1")),
    );
    const out = path.join(dir, "rows.json");
    const args = { ...parseArgs(["--competitions", "lec,lck", "--out", out], map), pageSize: 500 };
    await runProStats(args, { get, stats: { network: 0, cacheHits: 0, retries: 0, retryReasons: {} } } as never, () => {}, map);
    const index = JSON.parse(fs.readFileSync(playersPath(out), "utf8"));
    expect(Object.keys(index.players)).toHaveLength(20);
    expect(index.players["DK-Top"].teams).toEqual([{ team: "DK", competition: "lck", games: 1, lastDate: "2025-03-01" }]);
    expect(index.source).toMatch(/CC BY-SA 3.0/);
    expect(fs.readFileSync(playersPath(out), "utf8").endsWith("\n")).toBe(true);
  });
});
