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
  it("writes the areas in the order a person reads them: bar, map, feed, controls, blue cards, red cards", () => {
    const order = ["live-area-bar", "live-area-map", "live-area-dock", "live-area-ctl", "live-area-blue", "live-area-red"].map((name) =>
      screen.indexOf(`"${name}`),
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps the map first on every width, and the cards after the controls on a phone", () => {
    const phone = css.slice(atRuleStart("@container live (max-width: 719px)"));
    const areas = [...phone.slice(phone.indexOf("grid-template-areas")).matchAll(/"(\w+)"/g)].map((match) => match[1]).slice(0, 6);
    expect(areas).toEqual(["bar", "map", "dock", "ctl", "blue", "red"]);
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

  it("never lets the map pass 660 px or fall under the smallest readable size", () => {
    const side = /--map-side:\s*min\(([^;]*)\);/.exec(ruleBody(".live-shell"))?.[1] ?? "";
    expect(side).toContain("41.25rem");
    expect(side).toContain("20rem");
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
