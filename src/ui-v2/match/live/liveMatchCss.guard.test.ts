import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MATCH_ROOT = resolve(__dirname, "..");
const SRC_ROOT = resolve(MATCH_ROOT, "..", "..");
const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCES = walk(MATCH_ROOT).map((file) => ({ file: relative(SRC_ROOT, file), text: readFileSync(file, "utf8") }));

// Motion rules of the arena. The frame path moves things with `transform` from script; the
// stylesheet may fade opacity and nothing else, and never on a layer promoted ahead of time.
const TRANSITION_ALL = /transition(?:-property)?\s*:[^;]*\ball\b|\btransition-all\b/;
const WILL_CHANGE = /will-change/;
const STYLE_LEFT_TOP = /\.style\.(?:left|top)\s*=/;
const SET_PROPERTY_VAR = /setProperty\(\s*["']--/;
const TRANSFORM_FROM_VAR = /transform\s*:[^;]*var\(/;

function transitionedProperties(source: string): string[] {
  return [...source.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)].flatMap((match) =>
    match[1].split(",").map((part) => part.trim().split(/\s+/)[0]),
  );
}

function keyframeBodies(source: string): string[] {
  return [...source.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((match) => match[1]);
}

describe("the guard recognises what it bans", () => {
  it("flags transition: all and its spellings", () => {
    expect(TRANSITION_ALL.test("transition: all 150ms ease;")).toBe(true);
    expect(TRANSITION_ALL.test("transition-property: opacity, all;")).toBe(true);
    expect(TRANSITION_ALL.test("className='transition-all'")).toBe(true);
    expect(TRANSITION_ALL.test("transition: opacity 150ms ease;")).toBe(false);
  });

  it("flags will-change, left and top writes, and a transform driven by a variable", () => {
    expect(WILL_CHANGE.test("will-change: transform;")).toBe(true);
    expect(STYLE_LEFT_TOP.test("el.style.left = `${x}px`")).toBe(true);
    expect(STYLE_LEFT_TOP.test("el.style.transform = value")).toBe(false);
    expect(SET_PROPERTY_VAR.test('el.style.setProperty("--x", "1px")')).toBe(true);
    expect(TRANSFORM_FROM_VAR.test("transform: translate(var(--x), 0);")).toBe(true);
    expect(TRANSFORM_FROM_VAR.test("transform: translateX(-50%);")).toBe(false);
  });

  it("lists every property a transition names", () => {
    expect(transitionedProperties("transition: opacity 150ms ease, left 1s;")).toEqual(["opacity", "left"]);
  });
});

describe("arena motion", () => {
  it("sees the stylesheet and the sources", () => {
    expect(css).toContain(".arena-map");
    expect(SOURCES.length).toBeGreaterThan(5);
  });

  it("never transitions all", () => {
    expect(SOURCES.filter(({ text }) => TRANSITION_ALL.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it("transitions opacity and nothing else, so nothing smooths the frame path", () => {
    expect([...new Set(transitionedProperties(css))].filter((property) => property !== "none")).toEqual(["opacity"]);
  });

  it("promotes no layer ahead of a recording", () => {
    expect(SOURCES.filter(({ text }) => WILL_CHANGE.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it("never writes left or top from script, nor a variable that drives a transform", () => {
    const offenders = SOURCES.filter(
      ({ text }) => STYLE_LEFT_TOP.test(text) || SET_PROPERTY_VAR.test(text) || TRANSFORM_FROM_VAR.test(text),
    );
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("animates neither left nor top in a keyframe", () => {
    for (const body of keyframeBodies(css)) expect(body).not.toMatch(/\b(?:left|top)\s*:/);
  });

  it("switches its transitions off for people who ask for less motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.arena-champ\s*\{\s*transition:\s*none/);
  });
});

describe("arena shapes", () => {
  it("draws blue as a circle and red as a rounded square", () => {
    expect(css).toMatch(/\.arena-bubble\s*\{[^}]*border-radius:\s*50%/);
    expect(css).toMatch(/\[data-team="red"\] \.arena-bubble[^{]*\{[^}]*border-radius:\s*32%/);
  });

  it("marks a dead champion with a dashed outline", () => {
    expect(css).toMatch(/\[data-dead\] \.arena-bubble\s*\{[^}]*border-style:\s*dashed/);
  });
});
