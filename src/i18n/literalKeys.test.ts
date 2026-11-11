import { describe, expect, it } from "vitest";

import en from "./locales/en.json";

type Tree = Record<string, unknown>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const KEY_SHAPE = /^[A-Za-z_][\w-]*(\.[\w-]+)+$/;

// Every non-test source file, as text.
const SOURCES = import.meta.glob(
  ["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/**/*.d.ts"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/**
 * Files nothing imports from `src/main.tsx` (checked by following the import
 * graph): football leftovers of the v1 match screens. Their keys never render.
 */
const DEAD_FILES = new Map<string, string>([
  ["/src/ui-v2/_legacy/components/match/PostMatchScreen.tsx", "imported by no non-test file"],
  ["/src/ui-v2/_legacy/components/match/PostMatchHelpers.tsx", "only used by PostMatchScreen"],
  ["/src/ui-v2/_legacy/components/match/MatchPanels.tsx", "only used by the v1 match screens"],
  ["/src/ui-v2/_legacy/components/match/HalfTimeBreak.tsx", "only used by the v1 match screens"],
  ["/src/ui-v2/_legacy/components/match/MatchLive.tsx", "only used by the v1 match screens"],
]);

function keysOf(node: unknown, path = "", out = new Set<string>()): Set<string> {
  if (typeof node === "string") {
    out.add(path);
    out.add(path.replace(PLURAL_SUFFIX, ""));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Tree)) {
      keysOf(value, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

const EN_KEYS = keysOf(en);

interface Use {
  key: string;
  file: string;
  line: number;
  /** A default text travels with the call: the screen shows it in every language. */
  hasDefault: boolean;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** Collects every string literal key that a source file hands to i18next. */
function collectUses(file: string, source: string): Use[] {
  const uses: Use[] = [];

  for (const call of source.matchAll(/(?<![\w$])(?:t|translate)\(/g)) {
    const start = (call.index ?? 0) + call[0].length;
    let depth = 1;
    let end = start;
    while (end < source.length && depth > 0) {
      const char = source[end];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      end += 1;
    }
    const args = source.slice(start, end - 1);

    let nesting = 0;
    let comma = args.length;
    for (let i = 0; i < args.length; i += 1) {
      const char = args[i];
      if ("([{".includes(char)) nesting += 1;
      else if (")]}".includes(char)) nesting -= 1;
      else if (char === "," && nesting === 0) {
        comma = i;
        break;
      }
    }
    const first = args.slice(0, comma);
    const rest = args.slice(comma + 1);
    // Template strings build dynamic keys; they are out of scope.
    if (first.includes("`")) continue;

    const hasDefault = rest.includes("defaultValue") || /^\s*["'`]/.test(rest);
    for (const literal of first.matchAll(/["']([^"']+)["']/g)) {
      if (KEY_SHAPE.test(literal[1])) {
        uses.push({ key: literal[1], file, line: lineOf(source, call.index ?? 0), hasDefault });
      }
    }
  }

  for (const match of source.matchAll(/i18nKey=["']([^"']+)["']/g)) {
    uses.push({ key: match[1], file, line: lineOf(source, match.index ?? 0), hasDefault: false });
  }

  // Object fields such as labelKey / titleKey / descriptionKey.
  for (const match of source.matchAll(/\b\w*Key\s*:\s*["']([\w.-]+)["']/g)) {
    if (KEY_SHAPE.test(match[1])) {
      uses.push({ key: match[1], file, line: lineOf(source, match.index ?? 0), hasDefault: false });
    }
  }

  return uses;
}

const unresolved = Object.entries(SOURCES)
  .flatMap(([file, source]) => collectUses(file, source))
  .filter((use) => !EN_KEYS.has(use.key) && !DEAD_FILES.has(use.file));

const describeUse = (use: Use) => `${use.key} (${use.file.replace("/src/", "src/")}:${use.line})`;

describe("literal i18n keys used in code", () => {
  it("sees the source tree and the plural handling", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(300);
    expect(EN_KEYS.has("onAir.bar.toResolve")).toBe(true);
    expect(EN_KEYS.has("onAir.bar.toResolve_other")).toBe(true);
  });

  it("only allowlists files that no live file imports", () => {
    for (const file of DEAD_FILES.keys()) {
      const name = file.split("/").pop()!.replace(/\.tsx?$/, "");
      const importers = Object.entries(SOURCES).filter(
        ([other, source]) =>
          !DEAD_FILES.has(other) && new RegExp(`from\\s+["'][^"']*/${name}["']`).test(source),
      );
      expect(importers.map(([other]) => other), file).toEqual([]);
    }
  });

  it("resolves every literal key without a default in en.json", () => {
    const missing = unresolved.filter((use) => !use.hasDefault).map(describeUse);
    expect(missing).toEqual([]);
  });

  it("does not leave a key that lives only as a default text in the code", () => {
    const defaultOnly = unresolved.filter((use) => use.hasDefault).map(describeUse);
    expect(defaultOnly).toEqual([]);
  });
});
