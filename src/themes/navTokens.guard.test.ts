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
