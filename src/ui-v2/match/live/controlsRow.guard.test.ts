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

/** The text between the braces of the `@container live (<condition>)` block, nested rules included. */
function containerBlock(condition: string): string {
  const head = `@container live (${condition}) {`;
  const start = css.indexOf(head);
  expect(start, head).toBeGreaterThanOrEqual(0);
  let depth = 1;
  let i = start + head.length;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
    i += 1;
  }
  return css.slice(start + head.length, i - 1);
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

describe("controls row at laptop widths", () => {
  it("hides the speed note, and only it, where the row needs more than it has", () => {
    const block = containerBlock("max-width: 1335px");
    expect(block).toMatch(/\.arena-speed-note\s*\{[^}]*display:\s*none/);
    expect(ruleBody(".arena-speed-note")).not.toMatch(/display:\s*none/);
  });

  it("hides the note nowhere else, so it stays visible from 1336px (1440 included)", () => {
    const hiding = [...css.matchAll(/\.arena-speed-note\s*\{[^}]*display:\s*none/g)];
    expect(hiding).toHaveLength(1);
  });

  it("gives Pause, speeds and Options their own line when the rest cannot share it", () => {
    const block = containerBlock("min-width: 720px) and (max-width: 1079px");
    expect(block).toMatch(/\.live-area-ctl \.arena-controls\s*\{[^}]*flex-basis:\s*100%/);
    expect(block).toMatch(/--live-ctl:\s*7rem/);
  });
});
