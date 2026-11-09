// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DROP_REASONS, dateOf, normalizeRows } from "../../../scripts/stats/lib/normalize.mjs";
import type { RawRow } from "../../../scripts/stats/lib/queries.mjs";

const ROLES = ["Top", "Jungle", "Mid", "Bot", "Support"];

function raw(overrides: Partial<RawRow> = {}): RawRow {
  return {
    overviewPage: "LEC/2025 Season/Winter Season",
    gameId: "g1",
    link: "Caps",
    name: "Caps",
    team: "G2",
    role: "Mid",
    side: 1,
    kills: 5,
    deaths: 1,
    assists: 7,
    gold: 14000,
    cs: 300,
    damageToChampions: 20000,
    visionScore: 30,
    teamKills: 16,
    teamGold: 60000,
    dateTime: "2025-01-18 17:03:00",
    gameMinutes: 31.5,
    ...overrides,
  };
}

/** Two complete teams of five (10 rows) for one game. */
function game(gameId: string, overrides: Partial<RawRow> = {}): RawRow[] {
  const rows: RawRow[] = [];
  for (const [side, team] of [[1, "G2"], [2, "FNC"]] as const) {
    ROLES.forEach((role, i) => {
      rows.push(raw({ gameId, team, side, role, link: `${team}-${role}`, name: `${team}-${role}`, damageToChampions: 10000 + i * 1000, ...overrides }));
    });
  }
  return rows;
}

const norm = (rows: RawRow[]) => normalizeRows(rows, { competition: "lec" });

describe("normalizeRows", () => {
  it("maps rows to the skill input shape and sums the team damage", () => {
    const { rows, dropped, stats } = norm(game("g1"));
    expect(dropped).toEqual({});
    expect(stats).toEqual({ inputRows: 10, rows: 10, games: 1, players: 10 });
    const mid = rows.find((r) => r.playerKey === "G2-Mid")!;
    expect(mid).toEqual({
      playerKey: "G2-Mid",
      competition: "lec",
      role: "Mid",
      date: "2025-01-18",
      gameMinutes: 31.5,
      kills: 5,
      deaths: 1,
      assists: 7,
      teamKills: 16,
      damageToChampions: 12000,
      teamDamageToChampions: 10000 + 11000 + 12000 + 13000 + 14000,
      gold: 14000,
      teamGold: 60000,
      cs: 300,
      visionScore: 30,
    });
  });

  it("keeps a null visionScore and sums per team, not per game", () => {
    const { rows } = norm(game("g1", { visionScore: null }));
    expect(rows.every((r) => r.visionScore === null)).toBe(true);
    expect(new Set(rows.map((r) => r.teamDamageToChampions))).toEqual(new Set([60000]));
  });

  it("uses the playerKey from the Leaguepedia Link, not the name", () => {
    const rows = game("g1");
    rows[0] = { ...rows[0], link: "Canna (Kim Chang-dong)", name: "Canna" };
    expect(norm(rows).rows.map((r) => r.playerKey)).toContain("Canna (Kim Chang-dong)");
  });

  it.each([
    ["bad role", DROP_REASONS.role, { role: "Fill" }],
    ["bad date", DROP_REASONS.date, { dateTime: "2024-13-45 10:00:00" }],
    ["missing date", DROP_REASONS.date, { dateTime: null }],
    ["missing minutes", DROP_REASONS.minutes, { gameMinutes: null }],
    ["zero minutes", DROP_REASONS.minutes, { gameMinutes: 0 }],
    ["missing link", DROP_REASONS.link, { link: null }],
    ["missing kills", DROP_REASONS.stat, { kills: null }],
    ["missing team gold", DROP_REASONS.stat, { teamGold: null }],
    ["negative cs", DROP_REASONS.stat, { cs: -3 }],
  ])("drops a row with %s", (_name, reason, patch) => {
    const rows = game("g1");
    rows[2] = { ...rows[2], ...patch } as RawRow;
    const { rows: kept, dropped } = norm(rows);
    expect(dropped).toEqual({ [reason]: 1 });
    expect(kept).toHaveLength(9);
  });

  it("drops a whole team that does not have exactly 5 rows, and the other team survives", () => {
    const rows = game("g1").filter((r) => !(r.team === "FNC" && r.role === "Support"));
    const { rows: kept, dropped } = norm(rows);
    expect(dropped).toEqual({ [DROP_REASONS.teamSize]: 4 });
    expect(kept).toHaveLength(5);
    expect(kept.every((r) => r.playerKey.startsWith("G2-"))).toBe(true);
  });

  it("drops a team with 6 rows", () => {
    const rows = [...game("g1"), raw({ gameId: "g1", team: "G2", side: 1, role: "Mid", name: "Sub", link: "Sub" })];
    expect(norm(rows).dropped).toEqual({ [DROP_REASONS.teamSize]: 6 });
  });

  it("drops a team whose damage column is incomplete, since the total is unknowable", () => {
    const rows = game("g1");
    rows[0] = { ...rows[0], damageToChampions: null };
    const { rows: kept, dropped } = norm(rows);
    expect(dropped).toEqual({ [DROP_REASONS.teamDamage]: 5 });
    expect(kept).toHaveLength(5);
  });

  it("counts exact duplicate rows once and reports the repeats", () => {
    const rows = game("g1");
    const { rows: kept, dropped } = norm([...rows, rows[3], rows[7]]);
    expect(dropped).toEqual({ [DROP_REASONS.duplicate]: 2 });
    expect(kept).toHaveLength(10);
  });

  it("is deterministic: the same rows in any order give the same output", () => {
    const rows = [...game("g2", { dateTime: "2025-03-01 10:00:00" }), ...game("g1"), ...game("g3", { dateTime: "2025-01-18 20:00:00" })];
    const a = norm(rows);
    const b = norm([...rows].reverse());
    const c = norm([...rows].sort((x, y) => (x.name ?? "").localeCompare(y.name ?? "")));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.rows.map((r) => r.date)).toEqual([...a.rows.map((r) => r.date)].sort());
    expect(a.stats.games).toBe(3);
  });

  it("requires a competition id", () => {
    expect(() => normalizeRows([], { competition: "" })).toThrow(/competition/);
  });
});

describe("dateOf", () => {
  it("extracts a strict YYYY-MM-DD", () => {
    expect(dateOf("2025-01-18 17:03:00")).toBe("2025-01-18");
    expect(dateOf("2025-01-18")).toBe("2025-01-18");
    expect(dateOf("2024-02-29 00:00:00")).toBe("2024-02-29");
  });
  it("rejects impossible or malformed dates", () => {
    expect(dateOf("2024-13-45 10:00:00")).toBeNull();
    expect(dateOf("2023-02-29 10:00:00")).toBeNull();
    expect(dateOf("18/01/2025")).toBeNull();
    expect(dateOf("garbage 2025-01-18")).toBeNull();
    expect(dateOf(null)).toBeNull();
  });
});
