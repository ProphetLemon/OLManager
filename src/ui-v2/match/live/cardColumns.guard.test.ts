import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

const COMPACT = "@container live (min-width: 1240px) and (max-height: 806px) {";
const ROOT_PX = 16;
/** Row of the map at 1280x800: the 764px scroll root minus 290px of rows and gaps around it. */
const ROW_1280X800 = 474;
/** Height of the head row (name, role and level chips), which the compact block leaves alone. */
const HEAD_PX = 42.6;
const BORDER_PX = 2;

/** The text between the braces of the compact block, nested rules included. */
function compactBlock(): string {
  const start = css.indexOf(COMPACT);
  expect(start, COMPACT).toBeGreaterThanOrEqual(0);
  let depth = 1;
  let i = start + COMPACT.length;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
    i += 1;
  }
  return css.slice(start + COMPACT.length, i - 1);
}

/** The body of the first rule whose selector is exactly `selector` inside `text`. */
function ruleIn(text: string, selector: string): string {
  const escaped = selector.replace(/[.[\]"=*+?^${}()|\\]/g, "\\$&");
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `rule ${selector}`).not.toBeNull();
  return match![1];
}

/** A length in px or rem, as pixels. */
function px(value: string): number {
  const match = value.trim().match(/^([\d.]+)(px|rem)$/);
  expect(match, value).not.toBeNull();
  return Number(match![1]) * (match![2] === "rem" ? ROOT_PX : 1);
}

function declared(body: string, property: string): string {
  const match = body.match(new RegExp(`(?:^|[\\s;])${property}\\s*:\\s*([^;]+);`));
  expect(match, property).not.toBeNull();
  return match![1];
}

describe("player card columns on short windows", () => {
  const block = compactBlock();

  it("trims spacing only, and only where the cards sit beside the map", () => {
    // Stacked layouts (under 1240px wide) and tall windows keep the full-size cards.
    expect(COMPACT).toContain("min-width: 1240px");
    expect(block).not.toMatch(/font-size|font-family|display\s*:\s*none|visibility|overflow/);
    expect(declared(ruleIn(block, ".live-side"), "--arena-slot")).toBe("1.25rem");
    expect(declared(ruleIn(block, ".live-side .arena-card"), "padding-block")).toBe("2px");
  });

  it("leaves the full-size spacing in the base rules", () => {
    expect(declared(ruleIn(css, ".arena-card"), "padding")).toBe("4px 10px");
    expect(declared(ruleIn(css, ".arena-card"), "gap")).toBe("3px");
    expect(declared(ruleIn(css, ".live-side"), "gap")).toBe("0.375rem");
    expect(declared(ruleIn(css, ".arena-card-vitals"), "block-size")).toBe("1.125rem");
    expect(css).toMatch(/\.arena-item\s*\{[^}]*width:\s*var\(--arena-slot,\s*1\.375rem\)/);
  });

  it("fits five cards and four gaps in the 474px row of a 1280x800 window", () => {
    const padding = px(declared(ruleIn(block, ".live-side .arena-card"), "padding-block"));
    const rowGap = px(declared(ruleIn(block, ".live-side .arena-card"), "gap"));
    const whoGap = px(declared(ruleIn(block, ".live-side .arena-card-who"), "gap"));
    const slot = px(declared(ruleIn(block, ".live-side"), "--arena-slot"));
    const vitals = px(declared(ruleIn(block, ".live-side .arena-card-vitals"), "block-size"));
    const cardGap = px(declared(ruleIn(block, ".live-side"), "gap"));

    // The head is the name plus the role chips; its inner gap is the only part that shrinks.
    const head = HEAD_PX - (px(declared(ruleIn(css, ".arena-card-who"), "gap")) - whoGap);
    const card = BORDER_PX + 2 * padding + head + vitals + slot + 2 * rowGap;
    const column = 5 * card + 4 * cardGap;

    expect(card).toBeCloseTo(88.6, 1);
    expect(column).toBeLessThanOrEqual(ROW_1280X800);
  });

  it("does not fit without the change", () => {
    // The base rules: 98.6px cards with 6px gaps need 517px.
    const card = BORDER_PX + 8 + HEAD_PX + 18 + 22 + 6;
    expect(5 * card + 4 * 6).toBeGreaterThan(ROW_1280X800);
  });

  it("keeps the narrow card's gear row on the same slot size", () => {
    expect(css).toMatch(/block-size:\s*calc\(var\(--arena-slot,\s*1\.375rem\)\s*\+\s*3px/);
  });
});
