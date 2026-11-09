import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");
const SCAN_ROOTS = [join(SRC_ROOT, "ui-v2"), join(SRC_ROOT, "lib")];

// The shadcn primitives own their own tokens; everything else must use text-club-text.
const EXCLUDED = ["ui-v2/components/ui/", "ui-v2/shell/", "FloatingBugButton", "tokens.guard.test.ts"];

// Bare `text-primary`, optionally variant-prefixed or with /NN opacity. Hyphenated
// suffixes (text-primary-foreground, text-primary-500) are different tokens.
const BARE_TEXT_PRIMARY = /(?<![\w-])text-primary(?![\w-])/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("design token guard", () => {
  it("matches only the bare text-primary token", () => {
    expect(BARE_TEXT_PRIMARY.test('className="text-primary"')).toBe(true);
    expect(BARE_TEXT_PRIMARY.test("hover:text-primary/80")).toBe(true);
    expect(BARE_TEXT_PRIMARY.test("text-primary-foreground")).toBe(false);
    expect(BARE_TEXT_PRIMARY.test("text-primary-500")).toBe(false);
    expect(BARE_TEXT_PRIMARY.test("text-club-text")).toBe(false);
  });

  it("has no bare text-primary class outside the primitives", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const rel = relative(SRC_ROOT, file).split("\\").join("/");
        if (EXCLUDED.some((part) => rel.includes(part))) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (BARE_TEXT_PRIMARY.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
