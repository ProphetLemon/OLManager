import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ArenaMap } from "./ArenaMap";
import { createTestBus } from "./arenaFixtures.testing";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

/** The body of the first rule that starts with `selector`, from `source`. */
function body(selector: string, source = css): string {
  const at = source.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no rule for ${selector}`);
  return source.slice(at, source.indexOf("}", at));
}

/**
 * The compact tag form is a container query on the map. jsdom cannot evaluate it, so this pins the
 * wiring that makes it fire: the query container is the map element itself, the tags are inside
 * it, and the rule it names switches the long text off and the short text on at 520 px or less.
 */
describe("the compact form of the tags follows the width of the map", () => {
  it("makes the map element the one query container, named arena", () => {
    const map = body(".arena-map");
    expect(map).toMatch(/container-type:\s*inline-size/);
    expect(map).toMatch(/container-name:\s*arena/);
    expect(css.match(/container-name:\s*arena\b/g)).toHaveLength(1);
  });

  it("renders the map element with that class, and every layer inside it", () => {
    const { getByTestId } = render(<ArenaMap bus={createTestBus().bus} />);
    const map = getByTestId("arena-map");
    expect(map).toHaveClass("arena-map");
    expect(map.querySelectorAll(".arena-layer").length).toBeGreaterThan(0);
    for (const layer of map.querySelectorAll(".arena-layer")) expect(layer.closest(".arena-map")).toBe(map);
  });

  it("asks the container by its name, at 520 px or less, and swaps the long text for the short one", () => {
    const at = css.indexOf("@container arena (max-width: 520px) {");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}\n", css.indexOf(".arena-tag-short", at)) + 3);
    expect(block).toMatch(/\.arena-tag-long\s*\{\s*display:\s*none/);
    expect(block).toMatch(/\.arena-tag-short\s*\{\s*display:\s*inline/);
  });

  it("does not leave a gap at exactly 520 px, where the old rule stopped at 519", () => {
    expect(css).not.toContain("@container arena (max-width: 519px)");
  });
});
