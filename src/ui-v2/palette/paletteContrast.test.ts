import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { contrastRatio, resolveClubPalette } from "@/lib/teams/clubColors";

const css = readFileSync(resolve(__dirname, "../../themes/default.css"), "utf8");

/** A hex token of the dark theme. */
function darkToken(name: string): string {
  const body = css.match(/(?:^|\n)\.dark\s*\{([^}]*)\}/)?.[1] ?? "";
  const value = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`))?.[1];
  expect(value, name).toBeDefined();
  return value!;
}

/** `color-mix(in srgb, top share%, transparent)` painted over `base`. */
function over(top: string, share: number, base: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) => Math.round(share * channel(top, i) + (1 - share) * channel(base, i)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Clubs across the hue and lightness range, through the same resolver as the app.
const CLUBS = ["#f97316", "#1e3a8a", "#facc15", "#dc2626", "#16a34a", "#7c3aed", "#ffffff", "#111111"];
const palettes = CLUBS.map((primary) => ({
  primary,
  palette: resolveClubPalette({ id: "club", name: "Club", colors: { primary, secondary: "#a1a1aa" } }, {}),
}));

// The palette portals into <body>, under index.html's <html class="dark">, which nothing
// removes: the light tokens never paint it, so only the dark theme is checked.
describe("the Go palette's active row contrast, dark theme", () => {
  const popover = darkToken("--popover");
  const foreground = darkToken("--foreground");

  it("keeps the active row's text at 4.5:1 over the club wash, whatever the club (R75)", () => {
    for (const { primary, palette } of palettes) {
      const wash = over(palette.accent, 0.16, popover);
      expect(contrastRatio(foreground, wash), primary).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the active bar at 3:1 against the panel, whatever the club (R76)", () => {
    for (const { primary, palette } of palettes) {
      expect(contrastRatio(palette.accentText, popover), primary).toBeGreaterThanOrEqual(3);
    }
  });
});
