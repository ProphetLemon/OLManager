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

/** The text between the braces of the `@container <name> (<condition>)` block, nested rules included. */
function containerBlock(condition: string, name = "live"): string {
  const head = `@container ${name} (${condition}) {`;
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

  it.each([".arena-legend-summary"])("sizes %s to --hit in both dimensions", (selector) => {
    const body = ruleBody(selector);
    expect(body).toMatch(/min-width:\s*var\(--hit\)/);
    expect(body).toMatch(/min-height:\s*var\(--hit\)/);
  });
});

describe("Match options and Map key at 1360px and below", () => {
  const narrow = containerBlock("max-width: 1360px");

  it("clips the label, and keeps it in the page, so each button is an icon with its name", () => {
    expect(narrow).toMatch(/\.arena-btn-label\s*\{[^}]*position:\s*absolute[^}]*clip-path:\s*inset\(50%\)/);
    expect(narrow).not.toMatch(/\.arena-btn-label\s*\{[^}]*display:\s*none/);
    expect(css).not.toMatch(/\.arena-btn-label\s*\{[^}]*display:\s*none/);
  });

  it("keeps the touch target and marks an open key by a bar under it, not by the arrow that goes with the label", () => {
    expect(narrow).toMatch(/\.arena-legend\[open\] \.arena-legend-summary\s*\{[^}]*box-shadow:\s*inset 0 -3px 0 var\(--foreground\)/);
    expect(narrow).toMatch(/\.arena-legend-summary\s*\{[^}]*justify-content:\s*center/);
    expect(ruleBody(".arena-legend-summary")).toMatch(/min-width:\s*var\(--hit\)/);
  });

  it("clips from the live container's width, which is also where the key's list is placed", () => {
    expect(css).toContain("@container live (max-width: 1360px) {");
  });
});

describe("controls row at laptop widths", () => {
  /** Measured with the real stylesheet and fonts, over the 8 locales (px). */
  const SHELL_PADDING = 40;
  const GAP = 12;
  /**
   * [group without the note (Pause + speeds + Options + two gaps), the note, board + key + bug button + three gaps].
   * Measured when the Fight board sat in this row. It has since moved to the strip above the columns and the key
   * is an icon at 1360px and below, so the row is only narrower now: these figures stay an upper bound, and the
   * 1180px thresholds below stay safe without a new measurement (jsdom cannot take one).
   */
  const LOCALES: Record<string, [number, number, number]> = {
    es: [588, 229, 512],
    en: [534, 193, 358],
    de: [532, 200, 409],
    fr: [557, 223, 553],
    it: [572, 202, 541],
    pt: [562, 229, 504],
    "pt-BR": [562, 229, 477],
    tr: [588, 170, 450],
  };
  const rows = Object.values(LOCALES).map(([core, , others]) => core + others + SHELL_PADDING);
  const WIDEST_GROUP = Math.max(...Object.values(LOCALES).map(([core, note]) => core + GAP + note));

  it("makes the group a container of its own, so the note reads the room the group got", () => {
    expect(ruleBody(".arena-controls")).toMatch(/container:\s*controls\s*\/\s*inline-size/);
  });

  it("hides the speed note, and only it, where the group is too narrow for the whole sentence", () => {
    const block = containerBlock("max-width: 831px", "controls");
    expect(block).toMatch(/\.arena-speed-note\s*\{[^}]*display:\s*none/);
    expect(ruleBody(".arena-speed-note")).not.toMatch(/display:\s*none/);
    // The note shows only where the widest group content (core + gap + note, any locale) fits whole.
    expect(WIDEST_GROUP).toBe(829);
    expect(831).toBeGreaterThanOrEqual(WIDEST_GROUP);
  });

  it("lets the note shrink with an ellipsis instead of pushing the row onto a second line", () => {
    const body = ruleBody(".arena-speed-note");
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/text-overflow:\s*ellipsis/);
    expect(body).toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/flex:\s*0 1 auto/);
  });

  it("hides the note when the row is stacked, and nowhere else by window width", () => {
    const stacked = containerBlock("max-width: 1179px");
    expect(stacked).toMatch(/\.arena-speed-note\s*\{[^}]*display:\s*none/);
    expect(css).not.toContain("max-width: 1335px");
    const hiding = [...css.matchAll(/\.arena-speed-note\s*\{[^}]*display:\s*none/g)];
    expect(hiding).toHaveLength(2);
  });

  it("keeps the group on one line from 1180px, with its pieces at their size", () => {
    const block = containerBlock("min-width: 1180px");
    expect(block).toMatch(/\.live-area-ctl \.arena-controls\s*\{[^}]*flex-wrap:\s*nowrap/);
    for (const selector of [".arena-play", ".arena-speed", ".arena-options"]) {
      expect(block).toContain(selector);
    }
    expect(block).toMatch(/flex:\s*none/);
  });

  it("starts the one-line layout above the widest row measured in any locale", () => {
    expect(Math.max(...rows)).toBe(1153);
    expect(Math.max(...rows)).toBeLessThan(1180);
    // The two-line block ends where the one-line block starts.
    expect(css).toContain("@container live (min-width: 720px) and (max-width: 1179px) {");
  });

  it("gives Pause, speeds and Options their own line when the rest cannot share it", () => {
    const block = containerBlock("min-width: 720px) and (max-width: 1179px");
    expect(block).toMatch(/\.live-area-ctl \.arena-controls\s*\{[^}]*flex-basis:\s*100%/);
    expect(block).toMatch(/--live-ctl:\s*7rem/);
  });
});
