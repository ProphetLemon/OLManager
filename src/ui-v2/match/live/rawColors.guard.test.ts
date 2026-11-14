import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MATCH_ROOT = resolve(__dirname, "..");
const SRC_ROOT = resolve(MATCH_ROOT, "..", "..");

// Raw colours are banned in the match screen: it paints with the On Air tokens,
// the map tokens (--terrain-ground, --map-casing, --map-ink) and the team tokens. A hex literal or rgb()/hsl() call is
// a colour that skipped the theme.
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("match screen colours", () => {
  it("recognises raw colours", () => {
    expect(RAW_COLOR.test('fill="#0d131d"')).toBe(true);
    expect(RAW_COLOR.test("color: rgb(1 2 3)")).toBe(true);
    expect(RAW_COLOR.test("fill: var(--terrain-ground)")).toBe(false);
    expect(RAW_COLOR.test("id=\"#main\"")).toBe(false);
  });

  it("uses no raw colour under ui-v2/match or lib/match/live", () => {
    const offenders: string[] = [];
    for (const root of [MATCH_ROOT, join(SRC_ROOT, "lib", "match", "live")]) {
      for (const file of walk(root)) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (RAW_COLOR.test(line)) offenders.push(`${relative(SRC_ROOT, file)}:${i + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
