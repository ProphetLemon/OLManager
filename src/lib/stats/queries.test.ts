// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  FIELDS,
  ORDER_BY,
  assertValidPrefix,
  buildWhere,
  isValidIsoDate,
  rowsFromCargo,
  scoreboardPageParams,
  sqlString,
} from "../../../scripts/stats/lib/queries.mjs";

const base = { since: "2025-01-01", until: "2027-01-01", prefixes: ["LEC/"], offset: 0, pageSize: 500 };

describe("scoreboardPageParams", () => {
  it("joins the two tables with aliased fields and a stable order", () => {
    const params = scoreboardPageParams({ ...base, offset: 1000 });
    expect(params).toMatchObject({
      action: "cargoquery",
      tables: "ScoreboardPlayers=SP,ScoreboardGames=SG",
      join_on: "SP.GameId=SG.GameId",
      order_by: "SP.GameId,SP.Side,SP.Role,SP.Name",
      limit: "500",
      offset: "1000",
    });
    expect(params.fields.split(",")).toContain("SG.Gamelength_Number=GameMinutes");
    expect(params.fields.split(",")).toContain("SP.Link=Link");
    expect(params.fields.split(",")).toHaveLength(FIELDS.length);
    expect(ORDER_BY).toBe(params.order_by);
  });

  it("builds the date window and ORs the prefixes of one competition", () => {
    const where = scoreboardPageParams({ ...base, prefixes: ["LCK/", "Rift O'Neil/"] }).where;
    expect(where).toBe(
      "SP.DateTime_UTC >= '2025-01-01' AND SP.DateTime_UTC < '2027-01-01' AND (SP.OverviewPage LIKE 'LCK/%' OR SP.OverviewPage LIKE 'Rift O''Neil/%')",
    );
  });

  it("rejects bad dates, empty windows and bad paging", () => {
    expect(() => buildWhere({ ...base, since: "2024-13-45" })).toThrow(/since/);
    expect(() => buildWhere({ ...base, until: "2025-02-30" })).toThrow(/until/);
    expect(() => buildWhere({ ...base, since: "2027-01-01", until: "2025-01-01" })).toThrow(/earlier/);
    expect(() => scoreboardPageParams({ ...base, pageSize: 0 })).toThrow(/pageSize/);
    expect(() => scoreboardPageParams({ ...base, pageSize: 5001 })).toThrow(/pageSize/);
    expect(() => scoreboardPageParams({ ...base, offset: -1 })).toThrow(/offset/);
    expect(() => scoreboardPageParams({ ...base, prefixes: [] })).toThrow(/prefix/);
  });
});

describe("prefix validation", () => {
  it("accepts letters, digits, spaces and / . _ - '", () => {
    for (const prefix of ["LEC/", "Liga Regional Norte/", "Road Of Legends/", "A.b_c-d/2025", "D'Arc/"]) {
      expect(() => assertValidPrefix(prefix)).not.toThrow();
    }
  });

  it.each([
    ["' OR 1=1 --", "comment injection"],
    ["LEC/%", "LIKE wildcard"],
    ["x'; DROP TABLE y; --", "statement injection"],
    ["a(b)", "parentheses"],
    ["a\nb", "newline"],
    ["a\\b", "backslash"],
    ['a"b', "double quote"],
    ["", "empty"],
    ["x".repeat(101), "too long"],
  ])("rejects %j (%s)", (prefix) => {
    expect(() => assertValidPrefix(prefix)).toThrow(/invalid OverviewPage prefix/);
    expect(() => scoreboardPageParams({ ...base, prefixes: ["LEC/", prefix] })).toThrow(/invalid OverviewPage prefix/);
  });

  it("doubles single quotes in string literals", () => {
    expect(sqlString("O'Neil")).toBe("'O''Neil'");
  });
});

describe("isValidIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2023-02-29")).toBe(false);
    expect(isValidIsoDate("2024-13-45")).toBe(false);
    expect(isValidIsoDate("2024-1-5")).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
  });
});

describe("rowsFromCargo", () => {
  const title = {
    OverviewPage: "LEC/2025 Season/Winter Season",
    GameId: "LEC/2025 Season/Winter Season_Week 1_1_1",
    Link: "Caps",
    Name: "Caps",
    Team: "G2 Esports",
    Role: "Mid",
    Side: "1",
    Kills: "5",
    Deaths: "1",
    Assists: "7",
    Gold: "14500",
    CS: "310",
    DamageToChampions: "21000",
    VisionScore: "",
    TeamKills: "16",
    TeamGold: "62000",
    DateTimeUtc: "2025-01-18 17:03:00",
    GameMinutes: "31.5",
  };

  it("parses numbers and maps empty strings to null", () => {
    const [row] = rowsFromCargo({ cargoquery: [{ title }] });
    expect(row).toEqual({
      overviewPage: "LEC/2025 Season/Winter Season",
      gameId: "LEC/2025 Season/Winter Season_Week 1_1_1",
      link: "Caps",
      name: "Caps",
      team: "G2 Esports",
      role: "Mid",
      side: 1,
      kills: 5,
      deaths: 1,
      assists: 7,
      gold: 14500,
      cs: 310,
      damageToChampions: 21000,
      visionScore: null,
      teamKills: 16,
      teamGold: 62000,
      dateTime: "2025-01-18 17:03:00",
      gameMinutes: 31.5,
    });
  });

  it("turns malformed numbers and missing keys into null", () => {
    const [row] = rowsFromCargo({ cargoquery: [{ title: { ...title, Kills: "abc", Deaths: undefined, Link: "  " } }] });
    expect(row.kills).toBeNull();
    expect(row.deaths).toBeNull();
    expect(row.link).toBeNull();
  });

  it("returns [] for an empty page and throws for a malformed answer", () => {
    expect(rowsFromCargo({ cargoquery: [] })).toEqual([]);
    expect(() => rowsFromCargo({})).toThrow(/cargoquery/);
  });
});
