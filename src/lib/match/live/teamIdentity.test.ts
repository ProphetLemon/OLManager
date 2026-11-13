import { describe, expect, it } from "vitest";

import { tagFromName, teamIdentity } from "./teamIdentity";

describe("tagFromName", () => {
  it("takes the first letter of the first word and three of the second", () => {
    expect(tagFromName("Embers Esports")).toBe("EESP");
  });

  it("takes four letters of a single word and ignores punctuation", () => {
    expect(tagFromName("Rocket")).toBe("ROCK");
    expect(tagFromName("  Red-Fox  ")).toBe("RFOX");
  });
});

describe("teamIdentity", () => {
  it("prefers the short name of the game's own team list", () => {
    expect(teamIdentity("Karmine Corp", [{ name: "karmine corp", short_name: "KCB" }])).toEqual({
      tag: "KCB",
      name: "Karmine Corp",
    });
  });

  it("falls back to the league's well-known tags, then to the name", () => {
    expect(teamIdentity("G2 Esports").tag).toBe("G2");
    expect(teamIdentity("Team Heretics", []).tag).toBe("HRTS");
    expect(teamIdentity("Unknown Club").tag).toBe("UCLU");
  });

  it("skips a listed team that has an empty short name", () => {
    expect(teamIdentity("Fnatic", [{ name: "Fnatic", short_name: " " }]).tag).toBe("FNC");
  });
});
