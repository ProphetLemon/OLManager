// @vitest-environment node
// Regression guard: the roster refresh without any pool flag keeps producing exactly the bytes it produced before
// the active-pros pool mode existed. The hashes were taken from the recorded LCK + LEC fixtures at commit 96595a65.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MediaWikiClient } from "../../../scripts/world/lib/mediawiki-client.mjs";
import { serializeOverlay } from "../../../scripts/world/lib/overlay.mjs";
import { runRefresh } from "../../../scripts/world/lib/pipeline.mjs";
import { FIXTURES } from "./fixtures";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const OVERLAY_SHA = "9523a5346a65bc3623580e26b0579bb488bf6cc2ed179ff52b5b2dd8421df13a";
const REPORT_SHA = "6859fad4e462f5043b42c1c0a749da1bb35fdb7b84e9c8992bcb985d8aa139f5";
const CLI = path.resolve(__dirname, "../../../scripts/world/refresh.mjs");

describe("the default refresh is unchanged", () => {
  it("writes the same overlay bytes, report bytes and gates as before the pool mode", async () => {
    const result = await runRefresh({
      dataDir: FIXTURES.dataDir,
      teamMapPath: FIXTURES.teamMap,
      idMapPath: FIXTURES.idMap,
      client: new MediaWikiClient({ cacheDir: FIXTURES.cacheDir, offline: true }),
      asOf: "2026-11-07",
    });
    expect(sha256(serializeOverlay(result.overlay))).toBe(OVERLAY_SHA);
    expect(sha256(result.report)).toBe(REPORT_SHA);
    expect(result.gates.results).toHaveLength(6);
    expect(result.report).not.toContain("Active-pros pool");
  });

  it("prints the same summary and report from the command line, with no pool flag", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "world-default-"));
    try {
      const report = path.join(dir, "report.md");
      const run = spawnSync(
        process.execPath,
        [CLI, "--offline", "--dry-run", "--as-of", "2026-11-07", "--data-dir", FIXTURES.dataDir, "--team-map", FIXTURES.teamMap, "--id-map", FIXTURES.idMap, "--cache-dir", FIXTURES.cacheDir, "--report", report],
        { encoding: "utf8" },
      );
      expect(run.status).toBe(0);
      expect(run.stdout.split(report).join("<report>")).toBe(
        "players: 10 ops, staff: 8 ops, unmapped teams: 1, unreadable pages: 0\n" +
          "gates: 6/6 passed\n" +
          "requests: 0 live, 35 cached; report: <report>\n",
      );
      expect(sha256(fs.readFileSync(report, "utf8"))).toBe(REPORT_SHA);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
