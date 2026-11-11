import { describe, expect, it } from "vitest";

import { championPlaysRole, resolveRoleTier } from "./championRoleFit";

describe("championPlaysRole", () => {
  it("knows Ahri is a mid laner only", () => {
    expect(championPlaysRole("Ahri", "MID")).toBe(true);
    expect(championPlaysRole("Ahri", "JUNGLE")).toBe(false);
  });

  it("maps the catalogue's Bot role to ADC and ignores id punctuation", () => {
    expect(championPlaysRole("Jinx", "ADC")).toBe(true);
    expect(championPlaysRole("Lee Sin", "JUNGLE")).toBe(true);
  });

  it("returns null for a champion the catalogue does not know", () => {
    expect(championPlaysRole("NotAChampion", "MID")).toBeNull();
  });
});

describe("resolveRoleTier", () => {
  it("uses the tier listed for the role first", () => {
    expect(resolveRoleTier("C", "S", true)).toBe("C");
  });

  it("falls back to the best tier when the champion is on role or unknown", () => {
    expect(resolveRoleTier(undefined, "S", true)).toBe("S");
    expect(resolveRoleTier(undefined, "A", null)).toBe("A");
  });

  it("does not carry the best tier from another role to an off-role champion", () => {
    expect(resolveRoleTier(undefined, "S", false)).toBe("B");
  });

  it("defaults to B without any tier", () => {
    expect(resolveRoleTier(undefined, undefined, true)).toBe("B");
  });
});
