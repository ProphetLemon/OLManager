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
