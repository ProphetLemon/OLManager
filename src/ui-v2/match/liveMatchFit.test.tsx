import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { ChampionState } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

import { makeChampion } from "./live/arenaFixtures.testing";
import { LivePlayerCard } from "./live/LivePlayerCard";

/**
 * The watched match never scrolls its page at 1440x900 or 1280x800, at any minute. jsdom has no
 * layout, so this pins the structure that makes it true: a card whose shape does not depend on
 * what the player owns, a bounded grid row, and a card column that scrolls on its own. The real
 * sizes are measured in the app.
 */

const css = readFileSync(resolve(__dirname, "live/liveMatch.css"), "utf8");

/** The declarations of the rule whose selector list is exactly `selector` (commas may wrap): it starts a rule, so the last item of a longer list does not match. */
function ruleBody(selector: string, source = css): string {
  const pattern = selector
    .split(",")
    .map((part) => part.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(",\\s*");
  const match = new RegExp(`(?:^|[}/;{])\\s*${pattern}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

const atRule = (header: string): string => {
  const at = css.indexOf(header);
  if (at === -1) throw new Error(`no ${header}`);
  // The block of the at-rule: up to the next top level at-rule or the end.
  const rest = css.slice(at + header.length);
  const next = rest.search(/\n@(?:container|media)\s/);
  return next === -1 ? rest : rest.slice(0, next);
};

const NAMES = { abyssal_mask: "Abyssal Mask" };

function cardOf(over: Partial<ChampionState> = {}) {
  const champion = makeChampion("korvan", "blue", 0.3, 0.3, {
    name: "KORVAN",
    role: "TOP",
    level: 8,
    hp: 640,
    maxHp: 1200,
    ...over,
  });
  return render(
    <LivePlayerCard champion={champion} nowSec={100} fighting={false} selected={false} itemNames={NAMES} onSelect={() => {}} />,
  );
}

/** The rows of a card and what sits directly in each, by class: its shape, not its content. */
function shape(container: HTMLElement): string[] {
  const card = container.querySelector(".arena-card")!;
  return [...card.querySelectorAll<HTMLElement>(".arena-card-head, .arena-card-vitals, .arena-card-gear")].map((row) => {
    const own = [...row.children].map((child) => (child.className.includes("arena-card-") ? child.className : "?"));
    return `${row.className}: ${own.filter((name) => /items|cds/.test(name)).join(" ")}`;
  });
}

describe("a card has the same shape with nothing bought and with everything bought", () => {
  const FULL = ["a", "b", "c", "d", "e", "abyssal_mask"];
  const ALL_COOLDOWNS = {
    summonerSpells: [
      { key: "flash", cdUntil: 400 },
      { key: "ignite", cdUntil: 400 },
    ],
    ultimate: { archetype: "burst" as const, icon: "", cdUntil: 400 },
    trinketKey: "wardingtotem",
    wardCdUntil: 400,
  };

  it("reserves the six item slots and the cooldown strip from minute 0", () => {
    const { container } = cardOf({ items: [], summonerSpells: [], ultimate: undefined, trinketKey: undefined });
    expect(container.querySelectorAll(".arena-card-items .arena-item")).toHaveLength(6);
    expect(container.querySelectorAll(".arena-card-items .arena-item[data-empty]")).toHaveLength(6);
    expect(container.querySelector(".arena-card-gear > .arena-card-cds")).not.toBeNull();
    expect(container.querySelectorAll(".arena-card-cds .arena-cd")).toHaveLength(0);
  });

  it("keeps the same rows, and the same cells in them, once six items and four cooldowns arrive", () => {
    const empty = cardOf({ items: [], summonerSpells: [], ultimate: undefined, trinketKey: undefined });
    const before = shape(empty.container);
    empty.unmount();
    const full = cardOf({ items: FULL, ...ALL_COOLDOWNS });
    expect(full.container.querySelectorAll(".arena-card-items .arena-item")).toHaveLength(6);
    expect(full.container.querySelectorAll(".arena-card-items .arena-item[data-empty]")).toHaveLength(0);
    expect(full.container.querySelectorAll(".arena-card-cds .arena-cd").length).toBeGreaterThanOrEqual(3);
    expect(shape(full.container)).toEqual(before);
  });

  it("holds only the items and the cooldowns in the gear row, so nothing else competes for its width", () => {
    const { container } = cardOf({ items: FULL, ...ALL_COOLDOWNS });
    const gear = container.querySelector(".arena-card-gear")!;
    expect([...gear.children].map((child) => child.className)).toEqual(["arena-card-items", "arena-card-cds"]);
  });

  it("puts the state on the health row", () => {
    const { container } = cardOf();
    expect(container.querySelector(".arena-card-vitals > .arena-card-state")).not.toBeNull();
    expect(container.querySelector(".arena-card-gear .arena-card-state")).toBeNull();
  });
});

describe("the rows of a card are fixed and never wrap", () => {
  it("keeps the gear row on one line at a fixed height", () => {
    const gear = ruleBody(".arena-card-gear");
    expect(gear).toMatch(/flex-wrap:\s*nowrap/);
    expect(gear).toMatch(/block-size:\s*var\(--arena-slot,\s*1\.375rem\)/);
    expect(css).not.toMatch(/\.arena-card-gear\s*\{[^}]*flex-wrap:\s*wrap\b/);
  });

  it("gives an item slot a fixed size that cannot shrink, and lets the cooldown strip clip instead of grow", () => {
    expect(ruleBody(".arena-item")).toMatch(/flex:\s*none/);
    expect(ruleBody(".arena-item")).toMatch(/width:\s*var\(--arena-slot,\s*1\.375rem\)/);
    const strip = ruleBody(".arena-card-cds");
    expect(strip).toMatch(/min-width:\s*0/);
    expect(strip).toMatch(/overflow:\s*hidden/);
    expect(ruleBody(".arena-cd")).toMatch(/flex:\s*none/);
  });

  it("fixes the health row too, and lets the state chip give way", () => {
    expect(ruleBody(".arena-card-vitals")).toMatch(/block-size:\s*1\.125rem/);
    expect(ruleBody(".arena-card-state")).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("stacks the cooldowns on a line of their own when the column is narrow, in every card alike", () => {
    expect(ruleBody(".live-side")).toMatch(/container-type:\s*inline-size/);
    expect(ruleBody(".live-side")).toMatch(/container-name:\s*side/);
    const narrow = css.slice(css.indexOf("@container side (max-width: 21rem)"));
    expect(narrow.slice(0, 600)).toMatch(/\.arena-card-gear\s*\{[^}]*flex-direction:\s*column/);
  });
});

describe("the grid row comes from the window, not from the cards", () => {
  const shell = () => ruleBody(".live-shell");

  it("makes the shell exactly as tall as the room the app leaves, never less than the rows and the smallest map", () => {
    expect(shell()).toMatch(/\bheight:\s*100%/);
    expect(shell()).toMatch(/min-height:\s*calc\(var\(--live-rows\) \+ 20rem\)/);
  });

  it("bounds the row of the map and the cards: minmax(0, 1fr), not min-content", () => {
    const rows = /grid-template-rows:([^;]*);/.exec(shell())?.[1] ?? "";
    expect(rows).toMatch(/minmax\(0,\s*1fr\)/);
    expect(rows).not.toMatch(/min-content/);
  });

  it("lets each card column shrink to the row and scroll on its own, in a chain of min-height: 0", () => {
    const column = ruleBody(".live-area-blue,\n.live-area-red");
    expect(column).toMatch(/min-height:\s*0/);
    expect(column).toMatch(/overflow-y:\s*auto/);
    expect(column).toMatch(/grid-template-rows:\s*minmax\(min-content,\s*1fr\)/);
    expect(ruleBody(".live-side")).toMatch(/min-height:\s*0/);
    expect(ruleBody(".live-side")).toMatch(/grid-template-rows:\s*repeat\(5,\s*minmax\(min-content,\s*1fr\)\)/);
  });

  it("leaves room for the follow and focus rings inside the scrolling column", () => {
    const column = ruleBody(".live-area-blue,\n.live-area-red");
    expect(column).toMatch(/padding:\s*0\.25rem/);
    expect(column).toMatch(/margin:\s*-0\.25rem/);
  });

  it("goes back to the page scrolling when the cards sit under the map", () => {
    const stacked = atRule("@container live (max-width: 1239px)");
    expect(ruleBody(".live-shell", stacked)).toMatch(/height:\s*auto/);
    expect(ruleBody(".live-shell", stacked)).toMatch(/min-height:\s*100%/);
    const column = ruleBody(".live-area-blue,\n  .live-area-red", stacked);
    expect(column).toMatch(/overflow:\s*visible/);
  });

  it("keeps the single scroll root and its visible scrollbar on the cards", () => {
    const screen = readFileSync(resolve(__dirname, "LiveMatchV2.tsx"), "utf8");
    expect(screen).toMatch(/className="live-area-blue scrollbar-v2"/);
    expect(screen).toMatch(/className="live-area-red scrollbar-v2"/);
  });
});
