import { describe, expect, it } from "vitest";

import { contrastRatio, SURFACE } from "@/lib/teams/clubColors";
import type { TeamData } from "@/store/types";

import {
  MIN_ACHROMATIC_LIGHTNESS_GAP,
  MIN_PRIMARY_HUE_DEGREES,
  measureCloseness,
  primariesAreClose,
  resolveSideStyles,
} from "./sidePalette";

/** A user-created club: its authored colours are the ones the palette uses ("-custom-" in the id). */
const club = (slug: string, primary: string, secondary: string, logo_url: string | null = null) =>
  ({ id: `league-custom-${slug}`, name: slug, short_name: slug.toUpperCase(), logo_url, colors: { primary, secondary } }) as unknown as TeamData;

const ref = (team: TeamData) => ({ id: team.id, name: team.name });

const SHIFTERS = club("shifters", "#6A00E1", "#0B0715");
const KOI = club("koi", "#009EF7", "#edece8");
const EMBER = club("ember", "#e11d2e", "#f5f5f5");
const MOSS = club("moss", "#16a34a", "#101010");
const SUN = club("sun", "#fbbf24", "#101010");

describe("resolveSideStyles", () => {
  it("finds each club by team id, whatever order the list is in, and ignores a namesake with another id", () => {
    const namesake = { ...MOSS, id: "league-custom-other", name: SHIFTERS.name } as TeamData;
    const sides = resolveSideStyles([namesake, KOI, MOSS, SHIFTERS], ref(SHIFTERS), ref(MOSS));
    const alone = resolveSideStyles([SHIFTERS, MOSS], ref(SHIFTERS), ref(MOSS));
    expect(sides.blue.palette).toEqual(alone.blue.palette);
    expect(sides.red.palette).toEqual(alone.red.palette);
    expect(sides.blue.palette.source).toBe("custom");
  });

  it("clamps a dark accent up to 3:1 on the surface clamp and a light one stays as it is", () => {
    const dark = club("night", "#0B0715", "#101010");
    const light = club("snow", "#fffbe0", "#101010");
    const sides = resolveSideStyles([dark, light], ref(dark), ref(light));
    expect(contrastRatio(sides.blue.palette.accent, SURFACE)).toBeGreaterThanOrEqual(3);
    expect(sides.red.palette.accent).toBe("#fffbe0");
    expect(sides.red.palette.accentText).toBe("#fffbe0");
  });

  it("gives text at least 4.5:1 and a readable foreground on each accent fill", () => {
    const sides = resolveSideStyles([SHIFTERS, MOSS], ref(SHIFTERS), ref(MOSS));
    for (const { palette } of [sides.blue, sides.red]) {
      expect(contrastRatio(palette.accentText, SURFACE)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.foreground, palette.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("asks 4.5:1 of the accent in high contrast", () => {
    const normal = resolveSideStyles([SHIFTERS, MOSS], ref(SHIFTERS), ref(MOSS));
    const high = resolveSideStyles([SHIFTERS, MOSS], ref(SHIFTERS), ref(MOSS), { highContrast: true });
    expect(contrastRatio(normal.blue.palette.accent, SURFACE)).toBeLessThan(4.5);
    expect(contrastRatio(high.blue.palette.accent, SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps both accents when the primaries are far apart in hue", () => {
    const sides = resolveSideStyles([SHIFTERS, SUN], ref(SHIFTERS), ref(SUN));
    expect(sides.closeness.hueDegrees).toBeGreaterThanOrEqual(MIN_PRIMARY_HUE_DEGREES);
    expect(sides.fellBack).toBe(false);
    expect(sides.red.palette.source).toBe("custom");
    expect(sides.red.palette.accent).toBe("#fbbf24");
  });

  it("does not fall back for Shifters against Movistar KOI, though their clamped accents are 1.4:1 apart", () => {
    const sides = resolveSideStyles([SHIFTERS, KOI], ref(SHIFTERS), ref(KOI));
    expect(sides.closeness.hueDegrees).toBeGreaterThan(40);
    expect(sides.fellBack).toBe(false);
    expect(sides.red.palette.source).toBe("custom");
    expect(sides.red.palette.accent).toBe("#009ef7");
    expect(contrastRatio(sides.blue.palette.accent, sides.red.palette.accent)).toBeLessThan(1.5);
  });

  it("gives the red side its secondary colour when the two primaries share a hue", () => {
    const crimson = club("crimson", "#e11d2e", "#f5f5f5");
    const scarlet = club("scarlet", "#ff6a6a", "#101010");
    const sides = resolveSideStyles([crimson, scarlet], ref(crimson), ref(scarlet));
    expect(sides.closeness.hueDegrees).toBeLessThan(MIN_PRIMARY_HUE_DEGREES);
    expect(sides.fellBack).toBe(true);
    expect(sides.blue.palette.source).toBe("custom");
    expect(sides.red.palette.source).toBe("secondary");
    expect(sides.red.palette.accent).toBe(sides.red.palette.secondary);
    expect(contrastRatio(sides.red.palette.accent, SURFACE)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(sides.red.palette.foreground, sides.red.palette.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back for the same colour on both sides", () => {
    const twin = club("twin", "#e11d2e", "#f5f5f5");
    const sides = resolveSideStyles([EMBER, twin], ref(EMBER), ref(twin));
    expect(sides.fellBack).toBe(true);
    expect(sides.red.palette).toMatchObject({ source: "secondary", accent: "#f5f5f5", foreground: "#0a0a0a" });
  });

  it("compares two greys by lightness: close greys fall back, far ones do not", () => {
    const slate = club("slate", "#8a8a8a", "#e0e0e0");
    const stone = club("stone", "#909090", "#e0e0e0");
    const ink = club("ink", "#d8d8d8", "#202020");
    const close = resolveSideStyles([slate, stone], ref(slate), ref(stone));
    expect(close.closeness.hueDegrees).toBeNull();
    expect(close.closeness.lightnessGap).toBeLessThan(MIN_ACHROMATIC_LIGHTNESS_GAP);
    expect(close.fellBack).toBe(true);
    const far = resolveSideStyles([slate, ink], ref(slate), ref(ink));
    expect(far.closeness.lightnessGap).toBeGreaterThanOrEqual(MIN_ACHROMATIC_LIGHTNESS_GAP);
    expect(far.fellBack).toBe(false);
  });

  it("falls back when a club is missing from the list: both get the generic colours and the red side its secondary", () => {
    const sides = resolveSideStyles([], { id: "a", name: "Ghost One" }, { id: "b", name: "Ghost Two" });
    expect(sides.blue.palette.source).toBe("fallback");
    expect(sides.red.palette.source).toBe("secondary");
    expect(sides.blue.logoUrl).toBe("/teams-icons/ghostone.webp");
    expect(sides.red.logoUrl).toBe("/teams-icons/ghosttwo.webp");
    expect(resolveSideStyles(null, { id: "a", name: "A" }, { id: "b", name: "B" }).fellBack).toBe(true);
  });

  it("takes the logo from the club's own record, a generated badge of a custom club included", () => {
    const badge = "data:image/svg+xml;base64,PHN2Zy8+";
    const custom = club("badge", "#e11d2e", "#f5f5f5", badge);
    const listed = club("listed", "#16a34a", "#101010", "/teams-icons/listed.webp");
    const sides = resolveSideStyles([custom, listed], ref(custom), ref(listed));
    expect(sides.blue.logoUrl).toBe(badge);
    expect(sides.red.logoUrl).toBe("/teams-icons/listed.webp");
  });
});

describe("measureCloseness", () => {
  it("measures the smallest OKLCH hue angle, wrapping round the circle, and the lightness gap", () => {
    const wrapped = measureCloseness("#ff0040", "#ff4000");
    expect(wrapped.hueDegrees).toBeGreaterThan(0);
    expect(wrapped.hueDegrees).toBeLessThan(180);
    expect(measureCloseness("#ff0040", "#ff0040")).toEqual({ hueDegrees: 0, lightnessGap: 0 });
    expect(measureCloseness("#000000", "#ffffff").lightnessGap).toBeCloseTo(1, 1);
  });

  it("has no hue when either primary is a grey, even against a vivid colour", () => {
    expect(measureCloseness("#808080", "#e11d2e").hueDegrees).toBeNull();
    expect(measureCloseness("#e11d2e", "#808080").hueDegrees).toBeNull();
  });

  it("treats exactly the thresholds as apart", () => {
    expect(primariesAreClose({ hueDegrees: MIN_PRIMARY_HUE_DEGREES, lightnessGap: 0 })).toBe(false);
    expect(primariesAreClose({ hueDegrees: MIN_PRIMARY_HUE_DEGREES - 1, lightnessGap: 1 })).toBe(true);
    expect(primariesAreClose({ hueDegrees: null, lightnessGap: MIN_ACHROMATIC_LIGHTNESS_GAP })).toBe(false);
    expect(primariesAreClose({ hueDegrees: null, lightnessGap: MIN_ACHROMATIC_LIGHTNESS_GAP - 0.01 })).toBe(true);
  });
});
