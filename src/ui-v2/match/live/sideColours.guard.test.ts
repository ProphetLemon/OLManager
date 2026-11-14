import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SIDE_TOKEN_SUFFIXES } from "@/lib/match/live/sidePalette";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

interface Rule {
  selector: string;
  body: string;
}

/** Every flat rule of the stylesheet (nested at-rule bodies included), comments removed. */
function rules(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

const ALL = rules(css);
const GAME_COLOUR = /var\(--team-(?:blue|red)\)/;

/** What keeps the game's own blue and red: the structures, the push badge that points at one, and the legend's structure shape. */
const KEEPS_GAME_COLOUR = /\.arena-struct|\.arena-push|\[data-shape="structure"\]/;

describe("club colours in the stylesheet", () => {
  it("reads the game's blue and red only on structures, the push badge and the legend's structure, and in the defaults", () => {
    const offenders = ALL.filter(({ selector, body }) => GAME_COLOUR.test(body) && !KEEPS_GAME_COLOUR.test(selector) && selector !== ".live-match");
    expect(offenders.map(({ selector }) => selector)).toEqual([]);
  });

  it("paints every other team rule from the side tokens", () => {
    const teamRules = ALL.filter(({ selector, body }) => /--team-color:/.test(body) && /\[data-team=/.test(selector));
    expect(teamRules.length).toBeGreaterThan(6);
    for (const { selector, body } of teamRules) {
      const expected = KEEPS_GAME_COLOUR.test(selector) ? /var\(--team-(?:blue|red)\)/ : /var\(--side-(?:blue|red)\)/;
      expect(body, selector).toMatch(expected);
    }
  });

  it("keeps structures and the push badge on the game's colours, and wards on the club's", () => {
    const of = (selector: string) => ALL.find((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector))?.body ?? "";
    expect(of('.arena-struct[data-team="blue"]')).toContain("var(--team-blue)");
    expect(of('.arena-push[data-team="red"]')).toContain("var(--team-red)");
    expect(of('.arena-ward[data-team="blue"]')).toContain("var(--side-blue)");
    expect(of('.arena-ward[data-team="red"]')).toContain("var(--side-red)");
  });

  it("defaults every side token on the screen root, so no rule paints with an undefined variable", () => {
    const root = ALL.find((rule) => rule.selector === ".live-match")?.body ?? "";
    for (const side of ["blue", "red"]) {
      for (const suffix of SIDE_TOKEN_SUFFIXES) expect(root, `--side-${side}${suffix}`).toContain(`--side-${side}${suffix}:`);
    }
  });

  it("uses only side tokens the screen publishes", () => {
    const published = new Set(["blue", "red"].flatMap((side) => SIDE_TOKEN_SUFFIXES.map((suffix) => `--side-${side}${suffix}`)));
    const used = new Set([...css.matchAll(/var\((--side-[a-z-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((name) => !published.has(name))).toEqual([]);
  });

  it("keeps the shape cue of each side: blue round, red a rounded square", () => {
    expect(css).toMatch(/\.arena-crest\[data-team="red"\]\s*\{\s*border-radius:\s*32%/);
    expect(css).toMatch(/\.arena-bar-side-tag\[data-team="blue"\]\s*\{\s*border-radius:/);
    expect(css).toMatch(/\.arena-bar-side-tag\[data-team="red"\] \.arena-side-shape\s*\{\s*border-radius:\s*2px/);
  });
});
