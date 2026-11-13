import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

/** The body of the first rule whose selector is exactly `selector`, outside any at-rule. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.[\]"=*+?^${}()|\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `rule ${selector}`).not.toBeNull();
  return match![1];
}

describe("touch targets of the controls row", () => {
  it("sizes the speed buttons to --hit in both dimensions", () => {
    const body = ruleBody('.arena-speed [role="radio"]');
    expect(body).toMatch(/min-width:\s*var\(--hit\)/);
    expect(body).toMatch(/min-height:\s*var\(--hit\)/);
  });

  it.each([".arena-board-summary", ".arena-legend-summary"])("sizes %s to --hit in both dimensions", (selector) => {
    const body = ruleBody(selector);
    expect(body).toMatch(/min-width:\s*var\(--hit\)/);
    expect(body).toMatch(/min-height:\s*var\(--hit\)/);
  });
});
