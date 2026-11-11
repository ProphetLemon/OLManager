import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "default.css"), "utf8");
const appCss = readFileSync(resolve(__dirname, "../App.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("On Air design tokens", () => {
  it("declares the structural tokens", () => {
    for (const name of ["--club-wash", "--hit", "--target-min", "--surface-clamp", "--tag-skew", "--tag-outline-width", "--tag-outline-color"]) {
      expect(css).toContain(`${name}:`);
    }
  });

  it("binds primary, ring and sidebar tokens to the club in light and dark", () => {
    for (const selector of [":root", ".dark"]) {
      const b = block(selector);
      expect(b).toMatch(/--primary:\s*var\(--club\);/);
      expect(b).toMatch(/--primary-foreground:\s*var\(--club-foreground\);/);
      expect(b).toMatch(/--ring:\s*var\(--club-text\);/);
      expect(b).toMatch(/--sidebar-primary:\s*var\(--club\);/);
      expect(b).toMatch(/--sidebar-ring:\s*var\(--club-text\);/);
    }
  });

  it("uses the studio dark neutrals", () => {
    const b = block(".dark");
    expect(b).toMatch(/--background:\s*#0a0d13;/);
    expect(b).toMatch(/--card:\s*#141924;/);
    expect(b).toMatch(/--border:\s*#2a3347;/);
  });

  it("exposes the new colour, font and size utilities", () => {
    for (const name of ["--color-rail", "--color-dim", "--color-line", "--color-club-wash"]) {
      expect(css).toContain(`${name}:`);
    }
    expect(css).toContain('--font-heading: "Barlow Condensed"');
    for (const name of ["--text-section:", "--text-title:", "--text-ovr:", "--text-scoreboard:"]) {
      expect(css).toContain(name);
    }
  });

  it("keeps the high contrast blocks last and zeroes the wash", () => {
    const hcStart = css.indexOf(':root[data-contrast="high"]');
    expect(hcStart).toBeGreaterThan(css.indexOf(".dark {"));
    const tail = css.slice(hcStart);
    expect(tail.match(/--club-wash:\s*transparent;/g)).toHaveLength(2);
    expect(tail.match(/--tag-outline-width:\s*2px;/g)).toHaveLength(2);
    expect(tail).toContain("color-mix(in srgb, white 60%, transparent)");
    // Nothing but the two HC blocks follows the first HC selector.
    expect(tail.match(/\{/g)).toHaveLength(2);
  });

  it("imports Barlow Condensed weights and no Oswald", () => {
    for (const w of [400, 500, 600, 700, 800]) {
      expect(appCss).toContain(`@fontsource/barlow-condensed/${w}.css`);
    }
    expect(appCss.toLowerCase()).not.toContain("oswald");
    expect(css.toLowerCase()).not.toContain("oswald");
  });
});
