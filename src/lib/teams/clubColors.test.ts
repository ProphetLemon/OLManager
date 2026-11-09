import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_ACCENT,
  FALLBACK_SECONDARY,
  SURFACE,
  SURFACE_HEX,
  contrastRatio,
  ensureContrast,
  formatHex,
  hexToOklch,
  isChromatic,
  logoKeyForTeam,
  oklchToHex,
  parseHex,
  resolveClubPalette,
} from "./clubColors";

const LOGOS = {
  "fur2025.webp": { primary: "#1d4ed8", secondary: "#fbbf24" },
  "grey.webp": { primary: null, secondary: null },
} as const;

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe("colour maths", () => {
  it("computes known contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("parses and formats hex", () => {
    expect(parseHex("#FFF")).toEqual([255, 255, 255]);
    expect(parseHex("nope")).toBeNull();
    expect(formatHex([255, 0, 128])).toBe("#ff0080");
  });

  it("round-trips through OKLCH", () => {
    for (const hex of ["#f97316", "#1d4ed8", "#22c55e", "#a1a1aa"]) {
      const { l, c, h } = hexToOklch(hex);
      expect(oklchToHex(l, c, h)).toBe(hex);
    }
  });

  it("exports the dark surface that equals the --surface-clamp token", () => {
    expect(SURFACE).toMatch(/^#[0-9a-f]{6}$/);
    expect(SURFACE).toBe(SURFACE_HEX.toLowerCase());
    const css = readFileSync(resolve(__dirname, "../../themes/default.css"), "utf8");
    const token = css.match(/--surface-clamp:\s*(#[0-9a-fA-F]{6})\s*;/);
    expect(token?.[1].toLowerCase()).toBe(SURFACE);
  });

  it("distinguishes chromatic colours from placeholders", () => {
    expect(isChromatic("#000000")).toBe(false);
    expect(isChromatic("#ffffff")).toBe(false);
    expect(isChromatic("#808080")).toBe(false);
    expect(isChromatic("#f97316")).toBe(true);
    expect(isChromatic(null)).toBe(false);
  });

  it("leaves passing colours untouched and lightens failing ones", () => {
    expect(ensureContrast("#ffffff", SURFACE, 4.5)).toBe("#ffffff");
    const out = ensureContrast("#1d1d6b", SURFACE, 3);
    expect(contrastRatio(out, SURFACE)).toBeGreaterThanOrEqual(3);
    expect(hexToOklch(out).l).toBeGreaterThan(hexToOklch("#1d1d6b").l);
  });
});

describe("D9 sweep", () => {
  const cases: string[] = [];
  for (let hue = 0; hue < 360; hue += 10) {
    for (const [l, c] of [
      [0.15, 0.05],
      [0.3, 0.12],
      [0.45, 0.2],
      [0.6, 0.15],
      [0.75, 0.1],
      [0.92, 0.06],
    ]) {
      cases.push(oklchToHex(l, c, hue));
    }
  }

  for (const highContrast of [false, true]) {
    it(`meets contrast targets (highContrast=${highContrast})`, () => {
      for (const hex of cases) {
        const palette = resolveClubPalette(
          { id: "t", name: "T", logo_url: "/teams-icons/t.webp" },
          { "t.webp": { primary: hex, secondary: hex } },
          { highContrast },
        );
        expect(palette.source).toBe("logo");
        expect(contrastRatio(palette.accent, SURFACE)).toBeGreaterThanOrEqual(highContrast ? 4.5 : 3);
        expect(contrastRatio(palette.accentText, SURFACE)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.secondary, SURFACE)).toBeGreaterThanOrEqual(highContrast ? 4.5 : 3);
        expect(["#0a0a0a", "#ffffff"]).toContain(palette.accentForeground);
        expect(contrastRatio(palette.accentForeground, palette.accent)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("preserves hue for chromatic inputs", () => {
    for (const hex of cases) {
      const input = hexToOklch(hex);
      if (input.c < 0.05) continue;
      const palette = resolveClubPalette({ logo_url: "t.webp" }, { "t.webp": { primary: hex, secondary: hex } });
      for (const out of [palette.accent, palette.accentText]) {
        const o = hexToOklch(out);
        if (o.c < 0.03) continue;
        expect(hueDelta(o.h, input.h)).toBeLessThan(8);
      }
    }
  });
});

describe("precedence", () => {
  it("uses the chosen colours of a user-created club", () => {
    const palette = resolveClubPalette(
      {
        id: "lec-custom-ray",
        name: "Rayo",
        logo_url: "data:image/svg+xml;utf8,%3Csvg%3E",
        colors: { primary: "#16a34a", secondary: "#facc15" },
      },
      { "rayo.webp": { primary: "#ff0000", secondary: null } },
    );
    expect(palette.source).toBe("custom");
    expect(hexToOklch(palette.accent).h).toBeGreaterThan(130);
    expect(hexToOklch(palette.accent).h).toBeLessThan(160);
  });

  it("uses the logo palette before authored colours", () => {
    const palette = resolveClubPalette(
      { id: "fur", name: "Furia", logo_url: "/teams-icons/fur2025.webp", colors: { primary: "#16a34a", secondary: "#000000" } },
      LOGOS,
    );
    expect(palette.source).toBe("logo");
    expect(Math.abs(hexToOklch(palette.accent).h - hexToOklch("#1d4ed8").h)).toBeLessThan(8);
  });

  it("uses chromatic authored colours when the logo has none", () => {
    const palette = resolveClubPalette(
      { id: "x", name: "X", logo_url: "/teams-icons/grey.webp", colors: { primary: "#dc2626", secondary: "#ffffff" } },
      LOGOS,
    );
    expect(palette.source).toBe("authored");
  });

  it("falls back for grey authored colours", () => {
    const palette = resolveClubPalette(
      { id: "x", name: "Unknown", colors: { primary: "#808080", secondary: "#000000" } },
      LOGOS,
    );
    expect(palette.source).toBe("fallback");
    expect(palette.accent).toBe(ensureContrast(FALLBACK_ACCENT, SURFACE, 3));
    expect(palette.secondary).toBe(ensureContrast(FALLBACK_SECONDARY, SURFACE, 3));
  });

  it("falls back for a missing team", () => {
    expect(resolveClubPalette(null, LOGOS).source).toBe("fallback");
    expect(resolveClubPalette(undefined, LOGOS).source).toBe("fallback");
  });

  it("is deterministic", () => {
    const team = { id: "fur", name: "Furia", logo_url: "/teams-icons/fur2025.webp" };
    expect(resolveClubPalette(team, LOGOS)).toEqual(resolveClubPalette(team, LOGOS));
  });
});

describe("logoKeyForTeam", () => {
  it("strips path, query and hash", () => {
    expect(logoKeyForTeam({ logo_url: "/teams-icons/fur2025.webp?v=3#x" })).toBe("fur2025.webp");
    expect(logoKeyForTeam({ logo_url: "asset://localhost/teams-icons/fur2025.webp" })).toBe("fur2025.webp");
    expect(logoKeyForTeam({ logo_url: "fur2025.webp" })).toBe("fur2025.webp");
  });

  it("derives a slug when logo_url is absent", () => {
    expect(logoKeyForTeam({ name: "Fúria Esports!" })).toBe("furiaesports.webp");
    expect(logoKeyForTeam({ logo_url: null, name: "G2 Esports" })).toBe("g2esports.webp");
    expect(logoKeyForTeam({})).toBeNull();
  });
});
