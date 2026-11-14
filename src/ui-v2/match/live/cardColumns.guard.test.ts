import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

const COMPACT = "@container live (min-width: 1240px) and (max-height: 848px) {";
const TIGHT = "@container live (min-width: 1240px) and (max-height: 758px) {";
const ROOT_PX = 16;
/** The app's title bar takes 36px of the window; the screen's scroll root is what is left. */
const ROOT_1280X800 = 764;
const ROOT_1440X900 = 864;
/** Height of the head row (name, role and level chips), which the compact block leaves alone. */
const HEAD_PX = 42.6;
const BORDER_PX = 2;

/** The text between the braces of the block that opens with `head`, nested rules included. */
function blockOf(head: string): string {
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

const compactBlock = () => blockOf(COMPACT);
/** The block as a stylesheet, so `ruleIn` finds its rules. */
const compactBlockSource = () => compactBlock();

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

/**
 * The room the card column has, from the stylesheet: the scroll root less the rows around the
 * stage (padding, the bar of windows under 1540px, the lanes and board row, the controls row and
 * three gaps), the band, the low module under the column and the two gaps that separate them.
 * Where the cards sit beside the map the bar is the taller one (every window here is under 1540px).
 */
function cardRoom(root: number, lowBlock?: string): number {
  const match = ruleIn(css, ".live-match");
  const gap = px(declared(match, "--live-gap"));
  const rows =
    2 * px(declared(match, "--live-pad")) +
    px(declared(blockOf("@container live (max-width: 1539px) {"), "--live-bar")) +
    px(declared(match, "--live-sit")) +
    px(declared(match, "--live-ctl")) +
    3 * gap;
  const band = px(declared(ruleIn(css, ".live-band"), "block-size"));
  const low = px(declared(lowBlock ? ruleIn(lowBlock, ".live-shell") : match, "--live-low"));
  return root - rows - band - low - 2 * gap;
}

describe("the rows around the stage", () => {
  it("add up to the 196px the room is worked out from", () => {
    const match = ruleIn(css, ".live-match");
    expect(px(declared(match, "--live-sit"))).toBe(44);
    expect(px(declared(match, "--live-ctl"))).toBe(56);
    expect(px(declared(blockOf("@container live (max-width: 1539px) {"), "--live-bar"))).toBe(76);
    // 8 of padding, 76 of bar, 44 of lanes and board, 56 of controls, 3 gaps of 4.
    expect(cardRoom(ROOT_1280X800, compactBlockSource()) + 24 + 72 + 8).toBe(ROOT_1280X800 - 196);
  });

  it("leaves the full-size column room at 1440x900 with the 104px module, and the steps give the module up below", () => {
    const base = cardRoom(ROOT_1440X900);
    // Five 98.6px cards with four 6px gaps.
    expect(5 * (BORDER_PX + 8 + HEAD_PX + 18 + 22 + 6) + 4 * 6).toBeLessThanOrEqual(base);
    expect(px(declared(ruleIn(css, ".live-match"), "--live-low"))).toBe(104);
    expect(px(declared(ruleIn(compactBlock(), ".live-shell"), "--live-low"))).toBe(72);
    expect(px(declared(ruleIn(blockOf(TIGHT), ".live-shell"), "--live-low"))).toBe(68);
  });
});

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

  it("fits five cards and four gaps in the room a 1280x800 window leaves the column (464px)", () => {
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
    expect(cardRoom(ROOT_1280X800, compactBlockSource())).toBe(464);
    expect(column).toBeLessThanOrEqual(cardRoom(ROOT_1280X800, compactBlockSource()));
  });

  it("does not fit without the change", () => {
    // The base rules: 98.6px cards with 6px gaps need 517px, more than the room with either module.
    const card = BORDER_PX + 8 + HEAD_PX + 18 + 22 + 6;
    expect(5 * card + 4 * 6).toBeGreaterThan(cardRoom(ROOT_1280X800, compactBlockSource()));
    expect(5 * card + 4 * 6).toBeGreaterThan(cardRoom(ROOT_1280X800));
  });

  it("keeps the narrow card's gear row on the same slot size", () => {
    expect(css).toMatch(/block-size:\s*calc\(var\(--arena-slot,\s*1\.375rem\)\s*\+\s*3px/);
  });
});

describe("player card columns at 1366x768", () => {
  // A 768px window leaves a 732px scroll root. The stage is what the 196px of rows around it leave
  // (536px), and the column gets that less the 24px band, the 68px module and two 4px gaps.
  const ROOT_1366X768 = 732;
  const ROW_1366X768 = cardRoom(ROOT_1366X768, blockOf(TIGHT));
  /** A compact card as the real stylesheet lays it out (89px, measured), not the 88.6px estimate. */
  const COMPACT_CARD_PX = 89;
  const block = blockOf(TIGHT);

  it("opens below the root height where the compact step can fit, and only beside the map", () => {
    expect(TIGHT).toContain("min-width: 1240px");
    // 5 x 89 + 4 x 4 = 461px with the 72px module needs a 759px root; 1280x800 (764px) must keep the first step only.
    expect(TIGHT).toContain("max-height: 758px");
    expect(ROOT_1280X800).toBeGreaterThan(758);
    expect(ROOT_1366X768).toBeLessThan(758);
  });

  it("trims spacing only", () => {
    expect(block).not.toMatch(/font-size|font-family|display\s*:\s*none|visibility|overflow|block-size|--arena-slot/);
    expect(declared(ruleIn(block, ".live-side .arena-card"), "padding-block")).toBe("1px");
    expect(declared(ruleIn(block, ".live-side .arena-card"), "gap")).toBe("1px");
    expect(declared(ruleIn(block, ".live-side"), "gap")).toBe("0.125rem");
  });

  it("fits five cards and four gaps in the 442px row, and the first step alone does not", () => {
    const compact = compactBlock();
    const paddingSaved = px(declared(ruleIn(compact, ".live-side .arena-card"), "padding-block")) - px(declared(ruleIn(block, ".live-side .arena-card"), "padding-block"));
    const rowGapSaved = px(declared(ruleIn(compact, ".live-side .arena-card"), "gap")) - px(declared(ruleIn(block, ".live-side .arena-card"), "gap"));
    // Padding is saved above and below; a card has two row gaps.
    const card = COMPACT_CARD_PX - 2 * paddingSaved - 2 * rowGapSaved;
    const column = 5 * card + 4 * px(declared(ruleIn(block, ".live-side"), "gap"));
    const compactColumn = 5 * COMPACT_CARD_PX + 4 * px(declared(ruleIn(compact, ".live-side"), "gap"));

    expect(card).toBe(85);
    expect(ROW_1366X768).toBe(436);
    expect(column).toBeLessThanOrEqual(ROW_1366X768);
    expect(compactColumn).toBeGreaterThan(ROW_1366X768);
  });

  it("keeps the compact step's values for what the tight step does not touch", () => {
    const compact = compactBlock();
    expect(declared(ruleIn(compact, ".live-side"), "--arena-slot")).toBe("1.25rem");
    expect(declared(ruleIn(compact, ".live-side .arena-card-vitals"), "block-size")).toBe("1.0625rem");
  });
});
