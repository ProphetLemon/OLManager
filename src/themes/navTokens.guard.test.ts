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
  it("floors --text-rail at 10px, like --text-map", () => {
    expect(css).toMatch(/--text-rail:\s*max\(0\.75rem,\s*10px\);/);
  });
});

describe("safe-area tokens", () => {
  it.each(["top", "right", "bottom", "left"])("resolves --safe-%s to 0 without an inset", (side) => {
    expect(ruleBody(":root")).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px);`);
  });
});
