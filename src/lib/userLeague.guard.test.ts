import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");

// Raw reads of the head of the league list. The list is in manifest order, so its first
// entry is the user's league only by accident: use resolveUserLeague() instead.
const RAW_FIRST_LEAGUE = /leagues\??\.?\[0\]|leagues\??\.at\(0\)|leagues\??\.\s*first\b/;

// The resolver itself, plus readers that deliberately mean "the first one, whichever".
// Each entry needs a reason. (Currently none: every reader needs the user's league.)
const ALLOWLIST: Record<string, string> = {
  "lib/userLeague.ts": "the resolver's own fallback to the first league",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("user league guard", () => {
  it("matches the raw first-league reads", () => {
    expect(RAW_FIRST_LEAGUE.test("gameState.leagues[0]")).toBe(true);
    expect(RAW_FIRST_LEAGUE.test("gameState.leagues?.[0]?.fixtures")).toBe(true);
    expect(RAW_FIRST_LEAGUE.test("state.leagues.at(0)")).toBe(true);
    expect(RAW_FIRST_LEAGUE.test("resolveUserLeague(gameState)")).toBe(false);
    expect(RAW_FIRST_LEAGUE.test("leagues.slice(1)")).toBe(false);
  });

  it("reads no raw first league outside the resolver and the allowlist", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split("\\").join("/");
      if (rel in ALLOWLIST) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (RAW_FIRST_LEAGUE.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
