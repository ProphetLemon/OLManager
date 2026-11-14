import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArenaHarness } from "./arenaHarness.testing";
import { createTestBus, makeChampion, makeState } from "./arenaFixtures.testing";
import { ChampionLayer } from "./ChampionLayer";

/**
 * The solver and the guard work with the size of a probe, a hidden copy of the tag. If a probe
 * is not exactly as big as the tag it stands for, every tag is sized short and the guard lets two
 * tags overlap by the difference. The border of a tag takes its colour from `--team-color`, which
 * only a champion marker defines: a probe sits outside any marker, so without a colour of its own
 * its whole `border` shorthand was invalid and it lost the 1px border, 2px in each axis.
 */

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

/** The declarations of every plain rule whose selector list contains `selector`. */
function declarationsOf(selector: string): string {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  return rules
    .filter(([, selectors]) => selectors.split(",").some((one) => one.trim() === selector))
    .map(([, , body]) => body)
    .join(";");
}

describe("the probe of a tag stands in for the tag", () => {
  it("resolves every custom property that only a marker defines and the tag reads", () => {
    const markerOnly = new Set<string>();
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selectors.trim().startsWith(".arena-champ")) continue;
      for (const [, name] of body.matchAll(/(--[\w-]+)\s*:/g)) markerOnly.add(name);
    }
    const read = [...declarationsOf(".arena-tag").matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name);
    const needed = read.filter((name) => markerOnly.has(name));

    // The tag does read one (its border colour): otherwise this test checks nothing.
    expect(needed).toContain("--team-color");
    const probe = declarationsOf(".arena-tag-probe");
    for (const name of needed) expect(probe).toMatch(new RegExp(`${name}\\s*:`));
  });

  const hasChromium = (() => {
    try {
      return existsSync(chromium.executablePath());
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasChromium)(
    "has the size of the tag in a real browser, for every form of every champion",
    async () => {
      const test = createTestBus();
      const state = makeState({
        champions: [
          makeChampion("a", "blue", 0.2, 0.3, { name: "ALVARO", state: "recall", recallChannelUntil: 105.9 }),
          makeChampion("b", "red", 0.7, 0.6, { name: "JOJOPYUN", state: "objective" }),
          makeChampion("c", "blue", 0.5, 0.8, { name: "SUPA" }),
        ],
      });
      const markup = renderToStaticMarkup(
        <ArenaHarness bus={test.bus}>
          <ChampionLayer state={state} championByPlayerId={{}} contacts={{ fightingIds: [] }} selectedId={null} onSelect={() => {}} />
        </ArenaHarness>,
      );
      // The team colours come from the theme and the clubs' from the screen root, neither part of liveMatch.css.
      const page = `<style>:root{--team-blue:#2a7de1;--team-red:#e5484d;--side-blue:#2a7de1;--side-red:#e5484d}${css}</style>
        <div style="position:relative;width:540px;height:540px"><div class="arena-map" style="width:540px;height:540px"><div class="arena-layer">${markup}</div></div></div>`;

      const browser = await chromium.launch();
      try {
        const tab = await browser.newPage({ viewport: { width: 700, height: 700 } });
        await tab.setContent(page);
        const rows = await tab.evaluate(() => {
          const size = (element: Element) => {
            const { width, height } = element.getBoundingClientRect();
            return { width, height };
          };
          return [...document.querySelectorAll("[data-testid='tag']")].map((tag) => {
            const id = tag.closest("[data-testid^='champion-']")?.getAttribute("data-testid")?.slice("champion-".length);
            const form = tag.getAttribute("data-form");
            const probe = document.querySelector(`[data-probe='${id}'][data-form='${form}']`);
            return { id, form, tag: size(tag), probe: probe ? size(probe) : null };
          });
        });

        expect(rows).toHaveLength(3);
        for (const row of rows) {
          expect(row.probe, `${row.id}:${row.form}`).not.toBeNull();
          expect(row.probe?.width).toBeCloseTo(row.tag.width, 2);
          expect(row.probe?.height).toBeCloseTo(row.tag.height, 2);
        }
      } finally {
        await browser.close();
      }
    },
    30_000,
  );
});
