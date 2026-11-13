// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..", "..");
const MATCH_SIMULATION = join(SRC_ROOT, "ui-v2/_legacy/pages/MatchSimulation.tsx");

// The retired screen, written so this file does not contain the paths it looks for.
const RETIRED_MODULES = ["LolMatchLive", "lol-prototype/ui/" + "render", "lol-prototype/ui/" + "panels"];
const RETIRED_FILES = [
  "ui-v2/_legacy/components/match/LolMatchLive.tsx",
  "ui-v2/_legacy/components/match/LolMatchLive.interpolation.test.tsx",
  "ui-v2/_legacy/components/match/LolMatchLive.restart.test.tsx",
  "ui-v2/_legacy/components/match/lol-prototype/ui/render.ts",
  "ui-v2/_legacy/components/match/lol-prototype/ui/panels.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

/** A module specifier in an import, an export-from, a dynamic import or a vi.mock. */
const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+|vi\.(?:mock|doMock)\s*\(\s*)["']([^"']+)["']/g;

describe("the watched match renders the Arena screen", () => {
  const source = readFileSync(MATCH_SIMULATION, "utf8");

  it("mounts LiveMatchV2 from the first half", () => {
    expect(source).toMatch(/import LiveMatchV2 from "@\/ui-v2\/match\/LiveMatchV2"/);
    expect(source).toMatch(/<LiveMatchV2\b/);
    expect(source).not.toMatch(/<LolMatchLive\b/);
  });

  it("keeps its own skip and delegate paths: they are not the live screen's", () => {
    expect(source).toContain('source: "skip"');
  });
});

describe("the retired screen is gone", () => {
  it("deletes the screen, its renderer, its panels and their two tests", () => {
    expect(RETIRED_FILES.filter((file) => existsSync(join(SRC_ROOT, file)))).toEqual([]);
  });

  it("is imported, exported or mocked by no file", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      if (file.endsWith("liveMatchCutover.guard.test.ts")) continue;
      for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
        if (RETIRED_MODULES.some((module) => match[1].endsWith(module))) offenders.push(`${relative(SRC_ROOT, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("sees the sources it scans", () => {
    expect(walk(SRC_ROOT).length).toBeGreaterThan(500);
    expect([..."import x from \"@/a/LolMatchLive\";".matchAll(SPECIFIER)].map((match) => match[1])).toEqual(["@/a/LolMatchLive"]);
  });
});
