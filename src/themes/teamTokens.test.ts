import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "default.css"), "utf8");

function blockAfter(marker: string): string {
  const at = css.indexOf(marker);
  expect(at, `${marker} block`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  return css.slice(open, css.indexOf("\n}", open));
}

const BLOCKS = {
  light: blockAfter(":root {"),
  dark: blockAfter(".dark {"),
  lightHigh: blockAfter(':root[data-contrast="high"] {'),
  darkHigh: blockAfter('.dark[data-contrast="high"],'),
};

/** Blocks to search, most specific first. */
const CASCADE: Record<keyof typeof BLOCKS, Array<keyof typeof BLOCKS>> = {
  light: ["light"],
  dark: ["dark", "light"],
  lightHigh: ["lightHigh", "light"],
  darkHigh: ["darkHigh", "dark", "light"],
};

function declared(name: string, from: keyof typeof BLOCKS): string {
  for (const key of CASCADE[from]) {
    const m = new RegExp(`${name}:\\s*([^;]+);`).exec(BLOCKS[key]);
    if (m) return m[1].trim();
  }
  throw new Error(`${name} not declared for ${from}`);
}

function luminance(value: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }
  const gray = /^oklch\(\s*([\d.]+)\s+0\s+0\s*\)$/.exec(value);
  if (gray) return Number(gray[1]) ** 3; // achromatic oklch: linear light is L cubed
  throw new Error(`Cannot read a colour from "${value}"`);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("team tokens", () => {
  it.each(Object.keys(BLOCKS) as Array<keyof typeof BLOCKS>)("declares both team tokens in the %s block", (key) => {
    expect(BLOCKS[key]).toMatch(/--team-blue:\s*#[0-9a-f]{6};/i);
    expect(BLOCKS[key]).toMatch(/--team-red:\s*#[0-9a-f]{6};/i);
  });

  it("exposes the team tokens as Tailwind colours", () => {
    expect(css).toContain("--color-team-blue: var(--team-blue);");
    expect(css).toContain("--color-team-red: var(--team-red);");
  });

  it.each([
    ["light", 3],
    ["dark", 3],
    ["lightHigh", 4.5],
    ["darkHigh", 4.5],
  ] as const)("keeps both teams readable in the %s block (>= %s:1 on card and background, 3:1 on the terrain)", (key, minimum) => {
    const surfaces = [declared("--card", key), declared("--background", key)];
    for (const token of ["--team-blue", "--team-red"]) {
      const colour = declared(token, key);
      for (const surface of surfaces) {
        expect(contrast(colour, surface), `${token} ${colour} on ${surface} in ${key}`).toBeGreaterThanOrEqual(minimum);
      }
      // The arena is always dark, so the markers also have to stand out from it.
      const ground = declared("--terrain-ground", key);
      expect(contrast(colour, ground), `${token} ${colour} on terrain ${ground} in ${key}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the two teams apart in every block", () => {
    for (const key of Object.keys(BLOCKS) as Array<keyof typeof BLOCKS>) {
      expect(declared("--team-blue", key)).not.toBe(declared("--team-red", key));
    }
  });

  it.each(Object.keys(BLOCKS) as Array<keyof typeof BLOCKS>)(
    "keeps both teams and the warning colour readable on the map casing in the %s block (3:1)",
    (key) => {
      const casing = declared("--map-casing", key);
      for (const token of ["--team-blue", "--team-red", "--warning"]) {
        const colour = declared(token, key);
        expect(contrast(colour, casing), `${token} ${colour} on casing ${casing} in ${key}`).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("declares the map tokens once, theme independent: the Rift is pale in every theme", () => {
    for (const name of ["--terrain-ground", "--map-casing", "--map-ink"]) {
      expect(BLOCKS.light).toContain(`${name}:`);
      for (const key of ["dark", "lightHigh", "darkHigh"] as const) {
        expect(BLOCKS[key], `${name} redeclared in ${key}`).not.toContain(`${name}:`);
      }
    }
    expect(contrast(declared("--map-ink", "light"), declared("--map-casing", "light"))).toBeGreaterThanOrEqual(7);
  });

  it("no longer declares the terrain tokens nothing paints with", () => {
    for (const name of ["river", "lane-edge", "lane", "pit", "pit-edge", "wall", "path", "base"]) {
      expect(css, `--terrain-${name}`).not.toContain(`--terrain-${name}:`);
    }
  });
});
