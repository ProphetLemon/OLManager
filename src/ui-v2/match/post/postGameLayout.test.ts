import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * jsdom does not lay anything out, so the layout fixes of the post-game screen are pinned in the
 * stylesheet itself: a rule that forbids the shrink, a rule that moves the series strip. Whether the
 * result looks right is a real-window check, not something these assertions prove.
 */
const css = readFileSync(resolve(__dirname, "postGame.css"), "utf8");

/** The declarations of the first rule whose selector list contains `selector`. */
function rule(source: string, selector: string): string {
  const pattern = new RegExp(`(?:^|[}\\n])\\s*([^{}]*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{}]*)\\{([^}]*)\\}`);
  const found = pattern.exec(source);
  if (!found) throw new Error(`no rule for ${selector}`);
  return found[2];
}

describe("post-game layout rules", () => {
  it("never lets the gold chart panel shrink below what its axis and marker rail need", () => {
    const body = rule(css, '.pg-panel[data-kind="line"]');
    expect(body).toMatch(/flex:\s*1\s+0\s/);
    expect(body).toMatch(/min-height:\s*min-content/);
  });

  it("lets the graphs tab scroll instead of squeezing its panels", () => {
    expect(rule(css, ".pg-main")).toMatch(/overflow:\s*auto/);
  });

  it("moves the series strip under the tabs in a narrow window, and leaves wide ones as they are", () => {
    const query = /@media\s*\(max-width:\s*63\.9375rem\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(query, "a narrow-window media query").not.toBeNull();
    expect(rule(query![1], ".pg-tabs")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(query![1], ".pg-series")).toMatch(/flex:\s*1\s+0\s+100%/);
    expect(rule(query![1], ".pg-series")).toMatch(/order:\s*3/);
    // The wide layout keeps the strip in the row, with no order of its own.
    expect(rule(css, ".pg-series")).not.toMatch(/order:/);
  });

  it("keeps the two scoreboard tables on one fixed column grid", () => {
    expect(rule(css, ".pg-table")).toMatch(/table-layout:\s*fixed/);
  });
});
