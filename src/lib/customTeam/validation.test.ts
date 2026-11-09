import { describe, expect, it } from "vitest";

import {
  BACKEND_ERROR_TABLE,
  contrastRatio,
  defaultReplacementId,
  mapBackendCustomTeamError,
  normalizeColor,
  normalizeShortName,
  validateCustomTeam,
  type CustomTeamDraft,
} from "./validation";

const teams = [
  { id: "les-a", name: "Falké Esports", short_name: "FAL", reputation: 300 },
  { id: "les-b", name: "Other Club", short_name: "OTH", reputation: 200 },
  { id: "les-c", name: "Third Club", short_name: "THR", reputation: null },
];

function draft(overrides: Partial<CustomTeamDraft> = {}): CustomTeamDraft {
  return {
    name: "Ray Gaming",
    shortName: "ray",
    primary: "#F97316",
    secondary: "#18181b",
    country: "ES",
    replacesTeamId: "les-b",
    ...overrides,
  };
}

describe("validateCustomTeam", () => {
  it("accepts a valid draft", () => {
    expect(validateCustomTeam(draft(), teams)).toEqual({ ok: true, errors: {} });
  });

  it("checks the name length on the trimmed value", () => {
    expect(validateCustomTeam(draft({ name: "   " }), teams).errors.name).toBe("required");
    expect(validateCustomTeam(draft({ name: " ab " }), teams).errors.name).toBe("tooShort");
    expect(validateCustomTeam(draft({ name: "x".repeat(31) }), teams).errors.name).toBe("tooLong");
    expect(validateCustomTeam(draft({ name: "x".repeat(30) }), teams).ok).toBe(true);
  });

  it("rejects short names outside 3-4 alphanumerics", () => {
    expect(validateCustomTeam(draft({ shortName: "" }), teams).errors.shortName).toBe("required");
    expect(validateCustomTeam(draft({ shortName: "ab" }), teams).errors.shortName).toBe("tooShort");
    expect(validateCustomTeam(draft({ shortName: "abcde" }), teams).errors.shortName).toBe("tooLong");
    expect(validateCustomTeam(draft({ shortName: "ab-c" }), teams).errors.shortName).toBe("format");
    expect(validateCustomTeam(draft({ shortName: "ab12" }), teams).ok).toBe(true);
  });

  it("rejects malformed or missing colors", () => {
    expect(validateCustomTeam(draft({ primary: "orange" }), teams).errors.primary).toBe("format");
    expect(validateCustomTeam(draft({ primary: "#fff" }), teams).errors.primary).toBe("format");
    expect(validateCustomTeam(draft({ secondary: "" }), teams).errors.secondary).toBe("required");
  });

  it("requires a country and a replaced team", () => {
    const result = validateCustomTeam(draft({ country: " ", replacesTeamId: null }), teams);
    expect(result.errors.country).toBe("required");
    expect(result.errors.replaces).toBe("required");
    expect(result.ok).toBe(false);
  });

  it("detects duplicates ignoring case and accents", () => {
    const result = validateCustomTeam(draft({ name: "FALKE esports", shortName: "fal" }), teams);
    expect(result.errors.name).toBe("duplicate");
    expect(result.errors.shortName).toBe("duplicate");
  });

  it("lets the replaced team's own name and short name be reused", () => {
    const result = validateCustomTeam(
      draft({ name: "Falké Esports", shortName: "FAL", replacesTeamId: "les-a" }),
      teams,
    );
    expect(result.ok).toBe(true);
  });
});

describe("normalizers", () => {
  it("lowercases valid hex colors and uppercases short names", () => {
    expect(normalizeColor(" #F97316 ")).toBe("#f97316");
    expect(normalizeColor("nope")).toBe("nope");
    expect(normalizeShortName(" ray ")).toBe("RAY");
  });
});

describe("defaultReplacementId", () => {
  it("picks the lowest reputation and ignores unknown reputation", () => {
    expect(defaultReplacementId(teams)).toBe("les-b");
  });

  it("breaks ties by id", () => {
    expect(
      defaultReplacementId([
        { id: "z", reputation: 100 },
        { id: "a", reputation: 100 },
        { id: "m", reputation: 100 },
      ]),
    ).toBe("a");
  });

  it("returns null when no team has a reputation", () => {
    expect(defaultReplacementId([{ id: "a", reputation: null }, { id: "b" }])).toBeNull();
    expect(defaultReplacementId([])).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for identical colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
  });

  it("returns 1 for invalid input", () => {
    expect(contrastRatio("red", "#ffffff")).toBe(1);
  });
});

describe("mapBackendCustomTeamError", () => {
  // Every string below is the verbatim `Display` output of
  // `olm_core::custom_team::CustomTeamError` (custom_team.rs, `impl fmt::Display`).
  it.each([
    ["Club name must be 3 to 30 characters", "name", "format"],
    ["Short name must be 3 or 4 letters or digits", "shortName", "format"],
    ["Invalid color 'blue', expected #RRGGBB", "primary", "format"],
    ["Country is required", "country", "required"],
    ["Another team already uses this name", "name", "duplicate"],
    ["Another team already uses this short name", "shortName", "duplicate"],
    ["Team 'les-team-1' was not found", "replaces", "format"],
    ["The replaced team is not in this competition", "replaces", "format"],
    ["Only main clubs can be replaced", "replaces", "format"],
  ] as const)("maps the Rust message %j", (message, field, code) => {
    expect(mapBackendCustomTeamError(message)).toEqual({ field, code });
  });

  it("keeps matching when the message is wrapped with a stack trace", () => {
    expect(
      mapBackendCustomTeamError("Error: Another team already uses this short name\n\n  at x"),
    ).toEqual({ field: "shortName", code: "duplicate" });
  });

  it("covers every row of the table with a Rust message above", () => {
    expect(BACKEND_ERROR_TABLE).toHaveLength(9);
  });

  it("returns null for unrelated errors", () => {
    expect(mapBackendCustomTeamError("No active competition manifests available")).toBeNull();
  });
});
