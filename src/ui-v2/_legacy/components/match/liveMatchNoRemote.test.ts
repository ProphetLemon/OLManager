// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const matchDir = path.resolve(__dirname);
const srcDir = path.resolve(matchDir, "../../../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The watched match: the screen and its parts (ui-v2/match), its pure logic (lib/match/live), the map
 * layout the markers read, the profile loader and the whole prototype folder (engine, backend, ui).
 */
const LIVE_MATCH_FILES = [
  path.join(matchDir, "championProfiles.ts"),
  path.join(srcDir, "lib/match/lolMapLayout.ts"),
  ...sourceFiles(path.join(srcDir, "ui-v2/match")),
  ...sourceFiles(path.join(srcDir, "lib/match/live")),
  ...sourceFiles(path.join(matchDir, "lol-prototype")),
];

/** Remote URL literals that are legitimate in these files. Anything else must be a local path. */
const ALLOWED_REMOTE_LITERALS: string[] = [];

describe("the watched match downloads nothing", () => {
  it("scans the component and the prototype folder", () => {
    expect(LIVE_MATCH_FILES.length).toBeGreaterThan(40);
    expect(LIVE_MATCH_FILES.map((file) => path.basename(file))).toEqual(
      expect.arrayContaining(["LiveMatchV2.tsx", "ArenaMap.tsx", "useLiveSession.ts", "contacts.ts", "championProfiles.ts", "stepInterpolation.ts"]),
    );
  });

  it("has no Data Dragon address and no http(s) literal outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of LIVE_MATCH_FILES) {
      const text = fs.readFileSync(file, "utf8");
      if (/ddragon\.|leagueoflegends\.com/i.test(text)) offenders.push(`${path.relative(matchDir, file)}: Data Dragon`);
      for (const match of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
        if (!ALLOWED_REMOTE_LITERALS.some((allowed) => match[0].startsWith(allowed))) offenders.push(`${path.relative(matchDir, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("makes no fetch or XMLHttpRequest call", () => {
    const offenders = LIVE_MATCH_FILES.filter((file) => /\bfetch\s*\(|XMLHttpRequest/.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(matchDir, file));
    expect(offenders).toEqual([]);
  });

  it("points every icon at a local path that exists", () => {
    const publicDir = path.resolve(matchDir, "../../../../../public");
    const refs = new Set<string>();
    for (const file of LIVE_MATCH_FILES) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/"(\/(?:lol-ultimate-icons|lol-summoner-icons|lol-item-icons|lol-map-icons)\/[A-Za-z0-9_.-]+\.(?:png|webp))"/g)) refs.add(match[1]);
    }
    expect(refs.size).toBeGreaterThanOrEqual(6);
    const missing = [...refs].filter((ref) => !fs.existsSync(path.join(publicDir, ref)));
    expect(missing).toEqual([]);
  });

  it("has a local icon for every item the player cards can show", () => {
    const publicDir = path.resolve(matchDir, "../../../../../public");
    const catalogue = JSON.parse(fs.readFileSync(path.resolve(matchDir, "../../../../../assets/simulation/items.v1.json"), "utf8")) as {
      items: Array<{ key: string }>;
    };
    expect(catalogue.items.length).toBeGreaterThan(40);
    const missing = catalogue.items.map((item) => item.key).filter((key) => !fs.existsSync(path.join(publicDir, "lol-item-icons", `${key}.png`)));
    expect(missing).toEqual([]);
  });
});
