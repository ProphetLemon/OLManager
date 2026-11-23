import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { railCellClass } from "./RailUtility";
import { RAIL_FOCUS_CLASS } from "./RailItem";

const SHELL = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Built from parts so this guard does not name the token it forbids.
const NONE = ["outline", "none"].join("-");

// R88: in Tailwind 4 the none token is outline-style none, and the rail's focus ring is a
// box-shadow, which forced colours drops; outline-hidden keeps the transparent outline that
// forced colours paints, as R77 did for the palette input.
describe("the rail keeps a focus outline in forced colours (R88)", () => {
  it("uses no outline-style none token anywhere in shell/", () => {
    const offenders = sources(SHELL)
      .filter((file) => new RegExp(`(^|[\\s"':])${NONE}(?=[\\s"'\`]|$)`, "m").test(readFileSync(file, "utf8")))
      .map((file) => file.slice(resolve(SHELL).length + 1));
    expect(offenders).toEqual([]);
  });

  it("hides the outline only while it can be forced: focus-visible:outline-hidden, on stops, rows and cells", () => {
    expect(RAIL_FOCUS_CLASS).toContain("focus-visible:outline-hidden");
    expect(railCellClass()).toContain("focus-visible:outline-hidden");
    expect(railCellClass("danger")).toContain("focus-visible:outline-hidden");
  });

  // R98: the outline sits 2 px outside its box, and the scrolling Split column and panel
  // clip it at the top, so in forced colours it is drawn inside.
  it("draws the forced-colours outline inside the control, so a scroller cannot clip it (R98)", () => {
    expect(RAIL_FOCUS_CLASS).toContain("forced-colors:focus-visible:-outline-offset-2");
    expect(railCellClass()).toContain("forced-colors:focus-visible:-outline-offset-2");
  });
});
