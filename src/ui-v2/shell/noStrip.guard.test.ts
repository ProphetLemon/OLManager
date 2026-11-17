import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");
const SELF = resolve(__filename);
// Built from parts so this guard does not name the file it forbids.
const NAME = ["Section", "Strip", "V2"].join("");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("the section strip is gone", () => {
  it("has no strip component file", () => {
    expect(existsSync(join(SRC, `ui-v2/shell/${NAME}.tsx`))).toBe(false);
    expect(existsSync(join(SRC, `ui-v2/shell/${NAME}.test.tsx`))).toBe(false);
  });

  it("is imported or named nowhere in src", () => {
    const offenders = sources(SRC)
      .filter((file) => file !== SELF)
      .filter((file) => new RegExp(`${NAME}|section-strip`).test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
