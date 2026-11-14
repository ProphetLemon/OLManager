// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "live/liveMatch.css"), "utf8");
const screen = readFileSync(resolve(__dirname, "LiveMatchV2.tsx"), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`, at the top level or inside any at-rule. */
function ruleBody(selector: string, from = 0): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css.slice(from));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

const atRuleStart = (header: string): number => {
  const at = css.indexOf(header);
  if (at === -1) throw new Error(`no ${header}`);
  return at;
};

describe("the screen has no script-decided layout", () => {
  it("reads neither the pointer, nor touch points, nor the user agent, nor a window height", () => {
    expect(screen).not.toMatch(/isMobileLayout|matchMedia|maxTouchPoints|userAgent|innerHeight|screen\.width/);
  });

  it("is one scroll root: the shell scrolls, nothing nested in it does", () => {
    expect(ruleBody(".live-scroll")).toMatch(/overflow:\s*auto/);
    const shell = ruleBody(".live-shell");
    expect(shell).not.toMatch(/overflow/);
    expect(ruleBody(".live-match")).toMatch(/overflow:\s*hidden/);
  });
});

describe("reading order", () => {
  it("writes the areas in the order a person reads them: bar, lanes, map, fight board, away, caption and feed, controls, then each team's band, cards and timers", () => {
    const order = [
      '"live-area-bar"',
      '"live-area-lanes"',
      '"live-area-map"',
      '"live-area-fight"',
      '"live-area-away"',
      '"live-area-dock"',
      '"live-area-ctl"',
      'renderBand("blue"',
      '"live-area-blue scrollbar-v2"',
      '"live-area-rail"',
      'renderBand("red"',
      '"live-area-red scrollbar-v2"',
    ].map((marker) => screen.lastIndexOf(marker));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps the map first on every width, and the cards after the controls on a phone", () => {
    const phone = css.slice(atRuleStart("@container live (max-width: 719px)"));
    const areas = [...phone.slice(phone.indexOf("grid-template-areas")).matchAll(/"(\w+)"/g)].map((match) => match[1]).slice(0, 12);
    expect(areas).toEqual(["bar", "lanes", "map", "fight", "away", "dock", "ctl", "bband", "blue", "rail", "rband", "red"]);
  });
});

describe("no scroll at 1280x800", () => {
  it("caps the map by the room the app leaves it, at every width, not by a fixed window constant", () => {
    const shell = ruleBody(".live-shell");
    expect(shell).toMatch(/--map-side:[^;]*100cqh/);
    const midLayout = css.slice(atRuleStart("@container live (max-width: 1239px)"));
    expect(midLayout.slice(0, midLayout.indexOf("@container live (max-width: 719px)"))).toMatch(/--map-side:[^;]*100cqh/);
    expect(css).not.toMatch(/calc\(100vh/);
  });

  it("never lets the map pass 712 px or fall under the smallest readable size", () => {
    const side = /--map-side:\s*max\(([^;]*)\);/.exec(ruleBody(".live-shell"))?.[1] ?? "";
    expect(side).toContain("44.5rem");
    expect(side).toMatch(/^\s*20rem,/);
  });

  it("also caps the map by the width, so each card column keeps the 21rem the wide card needs", () => {
    const side = /--map-side:\s*max\(([^;]*)\);/.exec(ruleBody(".live-shell"))?.[1] ?? "";
    expect(side).toMatch(/100cqw[^,]*--live-col-min/);
    expect(ruleBody(".live-match")).toMatch(/--live-col-min:\s*21rem/);
    // The `side` container turns the card's cooldowns into a second line, but only below 19rem (304px):
    // the narrowest side-by-side column (21rem) keeps items and cooldowns on one line (see cardColumns.guard).
    expect(css).toContain("@container side (max-width: 19rem)");
    expect(css).not.toContain("@container side (max-width: 21rem)");
  });

  it("counts the taller bar of narrow windows in the room it takes off the map", () => {
    expect(ruleBody(".live-shell")).toMatch(/--live-rows:[^;]*var\(--live-bar\)/);
    const tall = css.slice(atRuleStart("@container live (max-width: 1539px)"));
    expect(tall.slice(0, 120)).toContain("--live-bar: 4.75rem");
  });
});

describe("the score bar fits at 1280 and 1440", () => {
  it("moves the stats of each side to a second row inside the bar below 1500 px", () => {
    const compact = css.slice(atRuleStart("@container bar (max-width: 1499px)"));
    const body = compact.slice(0, compact.indexOf("@container bar (max-width: 1180px)"));
    expect(body).toMatch(/\.arena-bar-side\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(body).toMatch(/\.arena-bar-stats\s*\{[^}]*flex:\s*1 0 100%/);
    expect(ruleBody(".arena-bar-stats")).toMatch(/display:\s*contents/);
  });
});

describe("the end panel", () => {
  it("aligns to the start and scrolls on its own", () => {
    const scrim = ruleBody(".live-scrim");
    expect(scrim).toMatch(/overflow:\s*auto/);
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(ruleBody(".live-end")).toMatch(/margin-block:\s*auto/);
  });
});

describe("nothing hidden can widen the page", () => {
  // A visually hidden sentence is absolutely positioned. When no positioned ancestor sits between
  // it and the scroll root, one in a feed row below the list's clip, or in a card scrolled out of
  // its column, counted as overflow of the whole root: the page scrolled 35 px at 1440x900 once the
  // feed had items. Each of these boxes clips or scrolls its content, so each is the containing block.
  it.each([".arena-ticker", ".arena-tk-list", ".live-area-dock", ".live-area-blue,\n.live-area-red"])(
    "%j is positioned, so what it clips cannot reach the scroll root",
    (selector) => {
      expect(ruleBody(selector)).toMatch(/position:\s*(?:relative|absolute)/);
    },
  );

  it("keeps the feed list and both card columns clipping what they hold", () => {
    expect(ruleBody(".arena-tk-list")).toMatch(/overflow-y:\s*auto/);
    expect(ruleBody(".live-area-blue,\n.live-area-red")).toMatch(/overflow-y:\s*auto/);
  });
});

describe("the stage: a band, the cards and a low module in each column, and the map across all three", () => {
  const areas = (from = 0) => [...css.slice(from).slice(css.slice(from).indexOf("grid-template-areas")).matchAll(/"([\w ]+)"/g)].map((match) => match[1]);

  it("lays out the bar, the lanes and board row, the stage rows and the controls where the three columns fit", () => {
    expect(areas().slice(0, 6)).toEqual(["bar bar bar", "fight lanes away", "bband map rband", "blue map red", "rail map dock", "ctl ctl ctl"]);
    const rows = /grid-template-rows:([^;]*);/.exec(ruleBody(".live-shell"))?.[1] ?? "";
    // bar, lanes and board, band (its own height), cards (bounded), low module, controls.
    expect(rows.replace(/\s+/g, " ").trim()).toBe("var(--live-bar) var(--live-sit) auto minmax(0, 1fr) var(--live-low) minmax(var(--live-ctl), auto)");
  });

  it("puts the lanes over the map column and the two board strips over the card columns", () => {
    const grid = areas()[1].split(" ");
    const columns = /grid-template-columns:([^;]*);/.exec(ruleBody(".live-shell"))?.[1] ?? "";
    expect(columns).toMatch(/minmax\(0, 1fr\) var\(--map-side\) minmax\(0, 1fr\)/);
    expect(grid).toEqual(["fight", "lanes", "away"]);
  });

  it("stacks the strips, the caption and feed, and the timers around one full-width map in the middle layout", () => {
    const mid = css.indexOf("@container live (max-width: 1239px)");
    expect(areas(mid).slice(0, 9)).toEqual([
      "bar bar",
      "lanes lanes",
      "map map",
      "fight away",
      "dock dock",
      "ctl ctl",
      "bband rband",
      "blue red",
      "rail rail",
    ]);
  });

  it("keeps the lane strip as wide as the map above it in every layout", () => {
    expect(ruleBody(".live-area-lanes")).toMatch(/grid-area:\s*lanes/);
    const mid = css.slice(atRuleStart("@container live (max-width: 1239px)"));
    expect(ruleBody(".live-area-lanes", atRuleStart("@container live (max-width: 1239px)"))).toMatch(/inline-size:\s*var\(--map-side\)/);
    expect(mid).toContain("justify-self: center");
  });
});
