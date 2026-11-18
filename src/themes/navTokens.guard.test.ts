import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "default.css"), "utf8");

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.[\]"=*+?^${}()|\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `rule ${selector}`).not.toBeNull();
  return match![1];
}

describe("touch hit size", () => {
  it("keeps the desktop floor at 24px", () => {
    expect(ruleBody(":root")).toMatch(/--hit:\s*max\(2\.75rem,\s*24px\);/);
  });

  it("raises the floor to 48px when the root is flagged android", () => {
    expect(ruleBody(':root[data-platform="android"]')).toMatch(/--hit:\s*max\(2\.75rem,\s*48px\);/);
  });
});

describe("nav text token", () => {
  it("floors --text-nav at 10px, like --text-map", () => {
    expect(css).toMatch(/--text-nav:\s*max\(0\.75rem,\s*10px\);/);
  });
});

describe("safe-area tokens", () => {
  it.each(["top", "right", "bottom", "left"])("resolves --safe-%s to 0 without an inset", (side) => {
    expect(ruleBody(":root")).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px);`);
  });
});

describe("token namespaces", () => {
  it("never gives a --text-* size the name of a --color-* token", () => {
    // Tailwind builds `text-<name>` from both namespaces, so a shared name makes the
    // colour utility win and the size silently fall back to the inherited one.
    const sizes = [...css.matchAll(/^\s*--text-([a-z0-9]+):/gm)].map((m) => m[1]);
    const colours = new Set([...css.matchAll(/^\s*--color-([a-z0-9-]+):/gm)].map((m) => m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((name) => colours.has(name))).toEqual([]);
  });
});

describe("rail tree tokens", () => {
  const expected: Record<string, string> = {
    "nav-row": "max(2rem, 32px)",
    "nav-row-child": "max(1.75rem, 28px)",
    "nav-cell": "max(2.25rem, 36px)",
    "nav-indent": "max(2.375rem, 32px)",
    "nav-icon": "max(1.25rem, 18px)",
    "rail-w-tree": "max(14rem, 192px)",
    "rail-w-split": "max(4.75rem, 64px)",
    "rail-w-compact": "max(3.5rem, 56px)",
    "nav-panel-w": "max(9rem, 136px)",
  };

  it.each(Object.entries(expected))("declares --%s as %s in :root", (name, value) => {
    expect(ruleBody(":root")).toContain(`--${name}: ${value};`);
  });

  it("declares every --nav-* and --rail-w-* token as max(rem, px)", () => {
    const declared = [...css.matchAll(/^\s*--((?:nav|rail-w)-[a-z-]+):\s*([^;]+);/gm)];
    expect(declared.length).toBeGreaterThanOrEqual(Object.keys(expected).length);
    for (const [, name, value] of declared) {
      expect(value, `--${name}`).toMatch(/^max\(\d+(?:\.\d+)?rem,\s*\d+(?:\.\d+)?px\)$/);
    }
  });

  it("gives no new token the name of a --color-* or --text-* token", () => {
    // Tailwind builds `text-<name>` / `bg-<name>` from those namespaces (the NR0 --text-rail lesson).
    const names = [...css.matchAll(/^\s*--((?:nav|rail-w)-[a-z-]+):/gm)].map((m) => m[1]);
    const taken = new Set(
      [...css.matchAll(/^\s*--(?:color|text)-([a-z0-9-]+):/gm)].map((m) => m[1]),
    );
    expect(names.filter((n) => taken.has(n))).toEqual([]);
  });
});

describe("the active row tint", () => {
  it("is one token, 16% of the club colour", () => {
    expect(ruleBody(":root")).toContain("--row-wash: color-mix(in srgb, var(--club) 16%, transparent);");
  });
});

describe("attention lane tokens (NR2.6, R24, R35)", () => {
  it("sizes the band at max(2.875rem, 46px) on desktop and at the touch hit plus the band's border on Android (R62)", () => {
    expect(ruleBody(":root")).toContain("--lane-h: max(2.875rem, 46px);");
    expect(ruleBody(':root[data-platform="android"]')).toContain("--lane-h: calc(var(--hit) + 1px);");
  });

  it("sizes the pills as a rail row on desktop and at the touch hit on Android", () => {
    expect(ruleBody(":root")).toContain("--lane-pill-h: var(--nav-row);");
    expect(ruleBody(':root[data-platform="android"]')).toContain("--lane-pill-h: var(--hit);");
  });

  it("floors --text-entry at 12px, so pill headlines never fall to 7.9 px on Android", () => {
    expect(css).toMatch(/--text-entry:\s*max\(0\.875rem,\s*12px\);/);
  });

  it("gives --text-entry and the lane tokens no --color-* or --text-* twin", () => {
    const colours = new Set([...css.matchAll(/^\s*--color-([a-z0-9-]+):/gm)].map((m) => m[1]));
    expect(colours.has("entry")).toBe(false);
    const taken = new Set([...css.matchAll(/^\s*--(?:color|text)-([a-z0-9-]+):/gm)].map((m) => m[1]));
    expect(["lane-h", "lane-pill-h"].filter((name) => taken.has(name))).toEqual([]);
  });
});

describe("Go palette tokens (NR2.8, spec §5.7, R29)", () => {
  it("caps the desktop panel to the window and floors its rows like a rail row", () => {
    const root = ruleBody(":root");
    expect(root).toContain("--palette-w: min(36rem, calc(100vw - 2rem));");
    expect(root).toContain("--palette-h: min(32rem, calc(100dvh - 6rem));");
    expect(root).toContain("--palette-row: max(2.5rem, 40px);");
    expect(root).toContain("--palette-sheet-w: max(22rem, 320px);");
  });

  it("raises the rows to the touch hit on Android", () => {
    expect(ruleBody(':root[data-platform="android"]')).toContain("--palette-row: var(--hit);");
  });

  it("gives the palette tokens no --color-* or --text-* twin", () => {
    const taken = new Set([...css.matchAll(/^\s*--(?:color|text)-([a-z0-9-]+):/gm)].map((m) => m[1]));
    const names = [...css.matchAll(/^\s*--(palette-[a-z-]+):/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(names.filter((name) => taken.has(name))).toEqual([]);
  });
});
