import { fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { CooldownChip as ChipView } from "@/lib/match/live/playerCardView";

import { archetypeGlyph, CooldownChip } from "./CooldownChip";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

const chip = (over: Partial<ChipView> = {}): ChipView => ({
  kind: "ultimate",
  state: "ready",
  letter: "R",
  key: null,
  seconds: 0,
  icon: "/lol-ultimate-icons/JinxR.png",
  archetype: "burst",
  unlockLevel: null,
  ...over,
});

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("archetypeGlyph", () => {
  it("has a glyph for each archetype of the kits and a default for any other", () => {
    const glyphs = ["burst", "engage", "defensive", "execute", "zone", "sustain", "global"].map(archetypeGlyph);
    expect(new Set(glyphs).size).toBe(7);
    expect(archetypeGlyph("mystery")).toBe(archetypeGlyph("burst"));
    expect(archetypeGlyph(null)).toBe(archetypeGlyph("burst"));
  });
});

describe("CooldownChip", () => {
  it("draws a summoner spell as its letter, with the seconds while it cools down", () => {
    const spell = chip({ kind: "summoner", letter: "F", key: "flash", icon: null, archetype: null });
    const { container, rerender } = render(<CooldownChip chip={spell} label="Flash ready" name="Flash" />);
    const el = container.firstElementChild!;
    expect(el).toHaveTextContent(/^F$/);
    expect(el).toHaveAttribute("data-ready");
    rerender(<CooldownChip chip={{ ...spell, state: "waiting", seconds: 40 }} label="Flash ready in 40 seconds" name="Flash" />);
    expect(container.firstElementChild).toHaveTextContent("F 40");
    expect(container.firstElementChild).not.toHaveAttribute("data-ready");
  });

  it("gives the ultimate three faces that differ by state, not only by colour", () => {
    const faces = (["ready", "waiting", "locked"] as const).map((state) => {
      const { container, unmount } = render(
        <CooldownChip chip={chip({ state, seconds: state === "waiting" ? 12 : 0, unlockLevel: state === "locked" ? 6 : null })} label={state} name="Ultimate" />,
      );
      const el = container.firstElementChild!;
      const face = { state: el.getAttribute("data-state"), secs: el.querySelector(".arena-cd-secs")?.textContent ?? null, lock: Boolean(el.querySelector(".arena-cd-lock")) };
      unmount();
      return face;
    });
    expect(faces).toEqual([
      { state: "ready", secs: null, lock: false },
      { state: "waiting", secs: "12", lock: false },
      { state: "locked", secs: null, lock: true },
    ]);
    expect(rule('.arena-cd-icon[data-state="ready"]')).toContain("3px double");
    expect(rule('.arena-cd-icon[data-state="waiting"]')).toContain("2px dashed");
    expect(rule('.arena-cd-icon[data-state="locked"]')).toContain("2px dotted");
  });

  it("falls back from a broken ultimate icon to the archetype glyph", () => {
    const { container } = render(<CooldownChip chip={chip()} label="Ultimate ready" name="Ultimate" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".arena-cd-glyph")).not.toBeNull();
  });

  it("draws the trinket as its icon in a round frame and its initials when the icon fails", () => {
    const trinket = chip({ kind: "trinket", key: "oracle_lens", letter: "", icon: "/lol-item-icons/oracle_lens.png", archetype: null });
    const { container } = render(<CooldownChip chip={trinket} label="Oracle Lens ready" name="Oracle Lens" />);
    expect(container.firstElementChild).toHaveClass("arena-cd-trinket");
    fireEvent.error(container.querySelector("img")!);
    expect(container.firstElementChild).toHaveTextContent("OL");
    expect(rule(".arena-cd-trinket")).toContain("border-radius: 50%");
  });

  it("keeps the chip the size of the slot, so the gear row does not grow", () => {
    expect(rule(".arena-cd-icon")).toMatch(/width: var\(--arena-slot, 1\.375rem\)/);
    expect(rule(".arena-cd-icon")).toMatch(/height: var\(--arena-slot, 1\.375rem\)/);
  });
});
