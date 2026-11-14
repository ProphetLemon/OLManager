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
  if (value.trim() === "0") return 0;
  const match = value.trim().match(/^([\d.]+)(px|rem)$/);
  expect(match, value).not.toBeNull();
  return Number(match![1]) * (match![2] === "rem" ? ROOT_PX : 1);
}

function declared(body: string, property: string): string {
  const match = body.match(new RegExp(`(?:^|[\\s;])${property}\\s*:\\s*([^;]+);`));
  expect(match, property).not.toBeNull();
  return match![1];
}


/** Every rule body whose selector list holds `selector` inside `text`, in source order. */
function rulesFor(text: string, selector: string): string[] {
  const escaped = selector.replace(/[.[\]"=*+?^${}()|\\]/g, "\\$&");
  const pattern = `(?:^|\\n)\\s*(?:[^{}]*,\\s*)?${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`;
  return [...text.matchAll(new RegExp(pattern, "g"))].map((match) => match[1]);
}

/**
 * A property as the step blocks leave it: the last block that sets it wins, then the base rule, then
 * `fallback` (the value the stylesheet uses where the base rule says nothing). `blocks` run from the
 * first step to the last, as the stylesheet applies them.
 */
function cascade(selector: string, property: string, base: string, blocks: string[], fallback?: string): string {
  const pick = (text: string, name: string) => {
    for (const body of rulesFor(text, name).reverse()) {
      const hit = body.match(new RegExp(`(?:^|[\\s;])${property}\\s*:\\s*([^;]+);`))?.[1];
      if (hit) return hit;
    }
    return undefined;
  };
  for (const text of [...blocks].reverse()) {
    const hit = pick(text, selector);
    if (hit) return hit;
  }
  const hit = pick(css, base);
  if (hit) return hit;
  if (fallback === undefined) throw new Error(`${selector} ${property}`);
  return fallback;
}

const SECTION_PX = 22; // --text-section, 1.375rem
const CAPTION_PX = 12; // --text-caption, 0.75rem
const FACE_PX = 36; // .arena-card-face, 2.25rem
/** The gear row's wrap is decided by the width of the `side` container: its widest wrapping width. */
const sideBreakPx = () => Number(css.match(/@container side \(max-width: ([\d.]+)rem\)/)![1]) * ROOT_PX;
/** The narrowest card column beside the map: the map is capped so a column never gets less. */
const colMinPx = () => px(declared(ruleIn(css, ".live-match"), "--live-col-min"));
/** The 17px strip the cooldowns get on a line of their own, and the 3px between the lines. */
const WRAPPED_STRIP_PX = 17;
const WRAPPED_GAP_PX = 3;

/** What a card is tall, from the cascade of `blocks` and a column `columnPx` wide (content box of the column). */
function cardPx(blocks: string[], columnPx: number): number {
  const card = ".live-side .arena-card";
  const padding = px(cascade(card, "padding-block", ".arena-card", blocks, "4px"));
  const rowGap = px(cascade(card, "gap", ".arena-card", blocks));
  // The item slot is 1.375rem unless a step sets --arena-slot on the column.
  const slot = px(cascade(".live-side", "--arena-slot", ".live-side", blocks, "1.375rem"));
  const vitals = px(cascade(".live-side .arena-card-vitals", "block-size", ".arena-card-vitals", blocks));
  // The head is the tallest of the portrait, the name over the chips, and the kills over the farm line.
  const whoGap = px(cascade(".live-side .arena-card-who", "gap", ".arena-card-who", blocks));
  const chipLine = Number(cascade(".live-side .arena-chip-text", "line-height", ".arena-chip-text", blocks));
  const who = SECTION_PX + whoGap + CAPTION_PX * chipLine + BORDER_PX;
  const scoreGap = px(cascade(".live-side .arena-card-score", "gap", ".arena-card-score", blocks));
  // Where nothing sets it the farm line takes the page's 1.5.
  const farmLine = Number(cascade(".live-side .arena-card-farm", "line-height", ".arena-card-farm", blocks, "1.5"));
  const score = SECTION_PX + scoreGap + CAPTION_PX * farmLine;
  const head = Math.max(FACE_PX, who, score);
  // Under the `side` breakpoint the cooldowns take a line of their own, in every card.
  const gear = columnPx <= sideBreakPx() ? slot + WRAPPED_GAP_PX + WRAPPED_STRIP_PX : slot;
  return BORDER_PX + 2 * padding + head + vitals + gear + 2 * rowGap;
}

/** Five cards and four gaps, with the step blocks applied. */
function columnPxOf(blocks: string[], columnPx: number): number {
  const gap = px(cascade(".live-side", "gap", ".live-side", blocks));
  return 5 * cardPx(blocks, columnPx) + 4 * gap;
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

  it("keeps the gear row on one line in the narrowest column beside the map, so a card is 83px", () => {
    // The map is capped so a column never gets less than 21rem, which is where a 1280x800 window sits.
    expect(colMinPx()).toBe(336);
    // The wrap breakpoint is under that column, or every card grows by 20px (T13 D1: 109px cards, 569px for 472px).
    expect(sideBreakPx()).toBeLessThan(colMinPx());
    // Six slots, a gap and the widest four chips (two "F 300" summoner boxes, two icons): 264px of the 314 inside a card.
    const slot = px(declared(ruleIn(block, ".live-side"), "--arena-slot"));
    const need = 6 * slot + 5 * 2 + 8 + 2 * 40 + 2 * slot + 3 * 2;
    expect(need).toBeLessThanOrEqual(colMinPx() - BORDER_PX - 20);
    // 2 border, 4 padding, a 36px head, a 17px health row, a 20px gear row and two 2px gaps.
    expect(cardPx([block], colMinPx())).toBe(83);
  });

  it("fits five cards and four gaps in the room a 1280x800 window leaves the column (464px), with a margin", () => {
    const room = cardRoom(ROOT_1280X800, compactBlockSource());
    expect(room).toBe(464);
    expect(columnPxOf([block], colMinPx())).toBe(431);
    expect(columnPxOf([block], colMinPx())).toBeLessThanOrEqual(room - 24);
  });

  it("would not fit if the gear row still wrapped at that width (the 109px cards T13 measured)", () => {
    // The same cascade with the old breakpoint: the wrap adds 3px and a 17px strip to each card.
    const wrapped = cardPx([block], colMinPx()) + WRAPPED_GAP_PX + WRAPPED_STRIP_PX;
    expect(wrapped).toBe(103);
    expect(5 * wrapped + 4 * 4).toBeGreaterThan(cardRoom(ROOT_1280X800, compactBlockSource()));
  });

  it("makes the head as tall as the portrait: the name and kills lines have no gap and a line the size of the text", () => {
    expect(declared(ruleIn(block, ".live-side .arena-card-who,\n  .live-side .arena-card-score"), "gap")).toBe("0");
    expect(ruleIn(block, ".live-side .arena-chip-text,\n  .live-side .arena-card-farm")).toMatch(/line-height:\s*1;/);
    // Name 22 + 14px chip; kills 22 + 12px farm line; the portrait 36px.
    expect(SECTION_PX + CAPTION_PX + BORDER_PX).toBe(36);
    expect(SECTION_PX + CAPTION_PX).toBe(34);
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
  /** The column a 1366-wide window gives the cards (the map takes the rest). */
  const ROOT_COLUMN_PX = 391;
  /** The room T13 measured in the real window at 1366x768: 432px of column, of which 8px are the scroll padding. */
  const MEASURED_1366X768 = 432;
  const block = blockOf(TIGHT);

  it("opens below the root height where the compact step can fit, and only beside the map", () => {
    expect(TIGHT).toContain("min-width: 1240px");
    // 1280x800 (764px) must keep the first step only: the second step shortens the module the feed lives in.
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

  it("fits five cards and four gaps in the 436px row, and in the 424px a real 1366x768 window left (T13)", () => {
    const compact = compactBlock();
    const column = columnPxOf([compact, block], ROOT_COLUMN_PX);
    const compactColumn = columnPxOf([compact], ROOT_COLUMN_PX);

    // 2 border, 2 padding, a 36px head, a 17px health row, a 20px gear row and two 1px gaps.
    expect(cardPx([compact, block], ROOT_COLUMN_PX)).toBe(79);
    expect(ROW_1366X768).toBe(436);
    expect(column).toBe(403);
    expect(column).toBeLessThanOrEqual(ROW_1366X768);
    // T13 measured a 432px column (424 for the cards) there and 9px of overflow; the tight step keeps a margin on that.
    expect(column).toBeLessThanOrEqual(MEASURED_1366X768 - 16);
    // The first step alone is 431px: it fits the estimate but not what was measured, so the tight step stays.
    expect(compactColumn).toBe(431);
    expect(compactColumn).toBeGreaterThan(MEASURED_1366X768 - 16);
  });

  it("keeps the compact step's values for what the tight step does not touch", () => {
    const compact = compactBlock();
    expect(declared(ruleIn(compact, ".live-side"), "--arena-slot")).toBe("1.25rem");
    expect(declared(ruleIn(compact, ".live-side .arena-card-vitals"), "block-size")).toBe("1.0625rem");
  });
});

describe("the timer rail's tiles on short windows", () => {
  const short = blockOf("@container live (max-height: 848px) and (min-width: 1240px) {");
  const FRAME_PX = 2 * 2;
  const LABEL_PX = 12;

  it("shrinks the number to 1rem on one line height, and gives the feed's heading up, only where the module is 72px or 68px", () => {
    expect(declared(ruleIn(short, ".arena-rail-value"), "font-size")).toBe("1rem");
    expect(declared(ruleIn(short, ".arena-rail-value"), "line-height")).toBe("1");
    expect(declared(ruleIn(short, ".arena-rail-text"), "line-height")).toBe("1");
    expect(ruleIn(short, ".live-area-dock .arena-ticker-heading")).toMatch(/display:\s*none/);
  });

  it("fits the two lines of a tile with the heavy frame of a monster that is up, in the 68px module of 1366x768", () => {
    const tight = px(declared(ruleIn(blockOf(TIGHT), ".live-shell"), "--live-low"));
    // Two tiles and the 4px gap between them fill the module.
    const tile = (tight - px(declared(ruleIn(css, ".arena-rail"), "gap"))) / 2;
    const text = LABEL_PX + px(declared(ruleIn(short, ".arena-rail-value"), "font-size"));
    expect(tile).toBe(32);
    expect(text).toBeLessThanOrEqual(tile - FRAME_PX);
  });
});

describe("the feed on short windows keeps a readable row (T13 D2)", () => {
  const short = blockOf("@container live (max-height: 848px) and (min-width: 1240px) {");
  /** The caption's kind tag (12px text in a 1.5 line, framed) is taller than one sentence line. */
  const KIND_TAG_PX = CAPTION_PX * 1.5 + BORDER_PX;
  /** One feed row as the app lays it out at 1280x800 (measured): the 22px icons and the padding. */
  const ROW_PX = 27;

  it("clamps the caption's sentence to one line where the module is 72px or 68px", () => {
    expect(ruleIn(short, ".live-area-dock .arena-sp-line")).toMatch(/-webkit-line-clamp:\s*1;/);
    // Over 848px the module is 104px and the base rule keeps its two lines.
    expect(rulesFor(css, ".live-area-dock .arena-sp-line").some((body) => /-webkit-line-clamp:\s*2;/.test(body))).toBe(true);
  });

  it("leaves the feed list a full row in both modules, which two caption lines did not", () => {
    const gap = px(declared(ruleIn(css, ".live-match"), "--live-gap"));
    const caption = (lines: number) => {
      const sentence = 16 * 1.1 * lines;
      return Math.max(KIND_TAG_PX, sentence) + 2 * 4 + BORDER_PX;
    };
    // Feed box: 2px of padding above and below and a 1px frame.
    const list = (module: number, lines: number) => module - gap - caption(lines) - (2 * 2 + BORDER_PX);
    for (const module of [px(declared(ruleIn(compactBlock(), ".live-shell"), "--live-low")), px(declared(ruleIn(blockOf(TIGHT), ".live-shell"), "--live-low"))]) {
      expect(list(module, 1), `${module}px, one line`).toBeGreaterThanOrEqual(ROW_PX);
      // Two lines took 12.6px to 16.6px in the real window: not a row.
      expect(list(module, 2), `${module}px, two lines`).toBeLessThan(ROW_PX);
    }
  });

  it("keeps every row to one line, so the newest row is whole however long its sentence is (T16 D1)", () => {
    const text = ruleIn(short, ".live-area-dock .arena-tk-text");
    expect(text).toMatch(/white-space:\s*nowrap/);
    expect(text).toMatch(/overflow:\s*hidden/);
    expect(text).toMatch(/text-overflow:\s*ellipsis/);
    expect(text).toMatch(/min-width:\s*0/);
    // A wrapped sentence is 41px in the real window, more than the 28px to 32px list; one line is a row.
    expect(ROW_PX).toBeLessThanOrEqual(28);
  });
});
