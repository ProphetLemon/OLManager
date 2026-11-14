import { describe, expect, it } from "vitest";

import { academyBlockedMessage, academyRegionKey } from "./acquisitionMessage";

describe("academyBlockedMessage", () => {
  it("maps the top-league rule code to its key", () => {
    expect(academyBlockedMessage("ACADEMY_PARENT_NOT_TOP_LEAGUE", null)).toEqual({
      key: "youthAcademy.blocked.notTopLeague",
    });
  });

  it("passes the region label to the no-candidates message", () => {
    expect(academyBlockedMessage("ACADEMY_NO_REGION_CANDIDATES", "Korea")).toEqual({
      key: "youthAcademy.blocked.noRegionCandidates",
      params: { region: "Korea" },
    });
  });

  it("maps the known English backend texts", () => {
    expect(
      academyBlockedMessage("Insufficient funds for all eligible academy acquisition options", null)?.key,
    ).toBe("youthAcademy.blocked.insufficientFunds");
    expect(academyBlockedMessage("Academy can only be acquired for a main team", null)?.key).toBe(
      "youthAcademy.blocked.notMainTeam",
    );
  });

  it("returns null for an unknown or missing reason", () => {
    expect(academyBlockedMessage("something else", null)).toBeNull();
    expect(academyBlockedMessage(null, null)).toBeNull();
  });
});

describe("academyRegionKey", () => {
  it("maps every region code the backend can send", () => {
    for (const code of ["EMEA", "KR", "CN", "NA", "BR", "LATAM", "APAC"]) {
      expect(academyRegionKey(code)).toBe(`youthAcademy.regions.${code}`);
    }
  });

  it("returns null for unknown or missing codes", () => {
    expect(academyRegionKey("MARS")).toBeNull();
    expect(academyRegionKey(undefined)).toBeNull();
  });
});
