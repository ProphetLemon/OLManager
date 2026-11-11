import { describe, expect, it } from "vitest";

import { championDisplayName } from "./championNames";

describe("championDisplayName", () => {
  it.each([
    ["AurelionSol", "Aurelion Sol"],
    ["DrMundo", "Dr. Mundo"],
    ["MonkeyKing", "Wukong"],
    ["Wukong", "Wukong"],
    ["Ahri", "Ahri"],
  ])("maps %s to %s", (key, expected) => {
    expect(championDisplayName(key)).toBe(expected);
  });

  it("falls back to the given name, then to the key, for an unknown champion", () => {
    expect(championDisplayName("Unknownia", "Unknownia the Great")).toBe("Unknownia the Great");
    expect(championDisplayName("Unknownia")).toBe("Unknownia");
  });
});
