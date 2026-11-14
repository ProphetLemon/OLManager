import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveSideStyles } from "./sidePalette";

import { neutralSide, tagFromName, teamIdentity } from "./teamIdentity";

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
    expect(teamIdentity("Karmine Corp", [{ name: "karmine corp", short_name: "KCB" }])).toMatchObject({
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

describe("team identity carries the side's logo and palette", () => {
  it("adds the logo and palette it is given to the tag and name", () => {
    const sides = resolveSideStyles([], { id: "a", name: "Fnatic" }, { id: "b", name: "G2 Esports" });
    const identity = teamIdentity("Fnatic", [], sides.blue);
    expect(identity).toEqual({ tag: "FNC", name: "Fnatic", logoUrl: "/teams-icons/fnatic.webp", palette: sides.blue.palette });
  });

  it("wears the generic palette and no logo when no side is given", () => {
    const identity = teamIdentity("Unknown Club");
    expect(identity.logoUrl).toBeNull();
    expect(identity.palette).toEqual(neutralSide().palette);
    expect(identity.palette.source).toBe("fallback");
  });

  it("is declared once: the score bar imports it instead of redeclaring it", () => {
    const root = resolve(__dirname, "..", "..", "..");
    const declarations: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && /(interface|type)\s+TeamIdentity\b/.test(readFileSync(full, "utf8"))) declarations.push(full.slice(root.length));
      }
    };
    walk(join(root, "lib", "match"));
    walk(join(root, "ui-v2", "match"));
    expect(declarations).toHaveLength(1);
  });
});
