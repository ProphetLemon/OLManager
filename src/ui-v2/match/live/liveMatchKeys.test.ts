import { describe, expect, it } from "vitest";

import en from "@/i18n/locales/en.json";

type Tree = Record<string, unknown>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const KEY_LITERAL = /["'`](onAir\.match\.[A-Za-z0-9_.]+)["'`]/g;
const PREFIX = "onAir.match.";

// Every non-test source file of the live match screen, as text.
const SOURCES = import.meta.glob(
  ["/src/ui-v2/match/**/*.{ts,tsx}", "!/src/ui-v2/match/**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

function leaves(node: unknown, path: string, out: string[] = []): string[] {
  if (typeof node === "string") out.push(path);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Tree)) leaves(value, `${path}.${key}`, out);
  }
  return out;
}

const enKeys = leaves((en as { onAir: { match?: unknown } }).onAir.match, "onAir.match");
/** Logical keys: a plural pair counts once, under its base name. */
const enLogical = new Set(enKeys.map((key) => key.replace(PLURAL_SUFFIX, "")));

const used = new Map<string, string[]>();
for (const [file, source] of Object.entries(SOURCES)) {
  for (const match of source.matchAll(KEY_LITERAL)) {
    used.set(match[1], [...(used.get(match[1]) ?? []), file]);
  }
}

describe("onAir.match keys", () => {
  it("sees the screen sources and the English block", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(3);
    expect(enKeys.length).toBeGreaterThan(0);
    expect(enKeys.every((key) => key.startsWith(PREFIX))).toBe(true);
  });

  it("defines in English every key the screen refers to", () => {
    const missing = [...used.keys()].filter((key) => !enLogical.has(key));
    expect(missing).toEqual([]);
  });

  it("has no key in English that the screen never refers to", () => {
    const orphans = [...enLogical].filter((key) => !used.has(key));
    expect(orphans).toEqual([]);
  });

  it("writes both plural forms of a counted key", () => {
    const keys = new Set(enKeys);
    for (const key of enKeys) {
      if (key.endsWith("_one")) expect(keys.has(key.replace(/_one$/, "_other")), key).toBe(true);
    }
  });
});
