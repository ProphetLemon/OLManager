import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

/** The declarations of every rule whose selector is exactly `selector`, joined. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]()]/g, "\\$&");
  const found = Array.from(css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{`, "g")));
  expect(found.length, `rule ${selector}`).toBeGreaterThan(0);
  return found
    .map((match) => {
      const open = css.indexOf("{", match.index);
      return css.slice(open + 1, css.indexOf("\n}", open));
    })
    .join("\n");
}

/**
 * The Rift picture is pale in every theme, so whatever the map draws over it wears the dark
 * `--map-casing` and, where it carries words, the light `--map-ink`. Reading `--background` or
 * `--foreground` would turn light in a light theme and vanish into the lanes.
 */
describe("map casing", () => {
  it.each([".arena-tag", ".arena-badge", ".arena-level", ".arena-chip", ".arena-struct-label", ".arena-push", ".arena-pit-label"])(
    "%s sits on the casing with the ink, not on the theme surface",
    (selector) => {
      const body = rule(selector);
      expect(body).toContain("background: var(--map-casing)");
      expect(body).toContain("color: var(--map-ink)");
      expect(body).not.toMatch(/var\(--(background|foreground)\)/);
    },
  );

  it("the tower chip keeps the ink the shared chip rule gives it", () => {
    expect(rule('.arena-chip[data-kind="tower"]')).not.toMatch(/(^|\s)color:/);
  });

  it("the champion bubble has a dark casing around its team ring", () => {
    expect(rule(".arena-bubble")).toMatch(/box-shadow:\s*0 0 0 2px var\(--map-casing\)/);
  });

  it("the fight ring is cased inside, between and outside its two coloured rings", () => {
    const shadow = rule(".ring-fighting");
    expect(shadow.match(/var\(--map-casing\)/g)).toHaveLength(3);
    expect(shadow.match(/var\(--warning\)/g)).toHaveLength(2);
    expect(shadow).not.toContain("--terrain-ground");
  });

  it("the health track is dark and its bar keeps the team colour", () => {
    expect(rule(".arena-hp")).toContain("background: var(--map-casing)");
    expect(rule(".arena-hp i")).toContain("background: var(--team-color)");
  });

  it.each([".arena-link-halo", ".arena-beam-head-halo"])("%s is the casing, wider than the stroke it lies under", (selector) => {
    const body = rule(selector);
    expect(body).toContain("stroke: var(--map-casing)");
    const halo = Number(/stroke-width:\s*(\d+)px/.exec(body)?.[1]);
    const beam = Number(/stroke-width:\s*(\d+)px/.exec(rule(".arena-beam"))?.[1]);
    expect(halo).toBeGreaterThanOrEqual(beam + 4);
  });

  it("the hit dot is cased too", () => {
    expect(rule(".arena-link-dot")).toContain("stroke: var(--map-casing)");
  });

  it("the arrowhead halo keeps the pixel width of the stroke it protects", () => {
    expect(css).toMatch(/\.arena-beam-head-halo,\n[^{]*\{\s*vector-effect: non-scaling-stroke/);
  });

  it("structure, pit and ward marks sit on the casing too, not on the theme surface", () => {
    expect(rule(".arena-struct-hp")).toContain("background: var(--map-casing)");
    expect(rule(".arena-pit-glyph-in")).toContain("background: var(--map-casing)");
    expect(rule(".arena-pit-glyph")).toContain("background: var(--map-ink)");
    expect(rule(".arena-pit-hp")).toContain("background: var(--map-casing)");
    expect(rule(".arena-ward-dot")).toContain("background: var(--map-casing)");
    expect(rule(".arena-camp-dot")).toMatch(/drop-shadow\(0 0 1px var\(--map-casing\)\)/);
  });

  it("nothing the map layers draw reads the theme surface or text tokens any more", () => {
    const selectors = [
      ".arena-struct-hp",
      ".arena-struct-label",
      ".arena-push",
      ".arena-pit-glyph",
      ".arena-pit-glyph-in",
      ".arena-pit-label",
      ".arena-pit-hp",
      ".arena-pit-hp i",
      ".arena-ward-dot",
      ".arena-tag",
      ".arena-chip",
    ];
    for (const selector of selectors) {
      expect(rule(selector), selector).not.toMatch(/var\(--(background|foreground|line)\)/);
    }
  });
});
