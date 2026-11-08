#!/usr/bin/env node
// Maintainer tool: compare Leaguepedia rosters with the bundled world and write a reviewed overlay.
// The shipped game never scrapes; it only consumes assets/world/roster-overlay.json.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MAX_CACHE_AGE_DAYS, DEFAULT_THROTTLE_MS, MediaWikiClient } from "./lib/mediawiki-client.mjs";
import { loginFromFile } from "./lib/bot-credentials.mjs";
import { loadGateExceptions } from "./lib/gates.mjs";
import { serializeOverlay } from "./lib/overlay.mjs";
import { resolveKeyPath, signOverlayFile } from "./lib/signing.mjs";
import { runRefresh } from "./lib/pipeline.mjs";
import { buildTeamMap, loadTeamMap, summarizeTeamMap } from "./lib/team-map.mjs";
import { coveredCompetitionIds, loadWorld } from "./lib/world.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HELP = `Usage: node scripts/world/refresh.mjs [flags]

  --competitions a,b      competition ids (default: every covered competition)
  --offline               read the cache only; fail on a miss
  --login                 log in with a Leaguepedia bot password from ~/.config/olmanager/leaguepedia-bot.env (opt-in;
                          see scripts/champions/README.md, "Logging in"); ignored with --offline
  --cache-dir <dir>       HTTP cache (default scripts/world/.cache)
  --throttle-ms <n>       minimum delay between live requests (default ${DEFAULT_THROTTLE_MS})
  --max-requests <n>      cap on live requests (default 3000)
  --max-cache-age-days <n> live runs re-fetch cache entries older than this (default ${DEFAULT_MAX_CACHE_AGE_DAYS})
  --as-of YYYY-MM-DD      overlay date (default: fetch date of the oldest cache entry used)
  --out <file>            overlay path (default assets/world/roster-overlay.json)
  --report <file>         review report (default scripts/world/out/report.md)
  --build-team-map        (re)build scripts/world/team-map.json, then exit
  --allow-gate-failures   write the overlay even if a plausibility gate fails
  --dry-run               do not write the overlay unless --out is given explicitly
  --gate-exceptions <file> reviewed max-changed-share exceptions (default scripts/world/gate-exceptions.json; missing = none)
  --data-dir, --team-map, --id-map   override input locations (tests, experiments)
`;

const { values } = parseArgs({
  options: {
    competitions: { type: "string" },
    offline: { type: "boolean", default: false },
    login: { type: "boolean", default: false },
    "cache-dir": { type: "string", default: path.join(ROOT, "scripts/world/.cache") },
    "throttle-ms": { type: "string", default: String(DEFAULT_THROTTLE_MS) },
    "max-requests": { type: "string", default: "3000" },
    "max-cache-age-days": { type: "string", default: String(DEFAULT_MAX_CACHE_AGE_DAYS) },
    "as-of": { type: "string" },
    out: { type: "string" },
    report: { type: "string", default: path.join(ROOT, "scripts/world/out/report.md") },
    "build-team-map": { type: "boolean", default: false },
    "allow-gate-failures": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "data-dir": { type: "string", default: path.join(ROOT, "data") },
    "team-map": { type: "string", default: path.join(ROOT, "scripts/world/team-map.json") },
    "gate-exceptions": { type: "string", default: path.join(ROOT, "scripts/world/gate-exceptions.json") },
    "id-map": { type: "string", default: path.join(ROOT, "scripts/world/id-map.json") },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const log = (message) => console.error(`[world] ${message}`);
const client = new MediaWikiClient({
  cacheDir: values["cache-dir"],
  offline: values.offline,
  throttleMs: Number(values["throttle-ms"]),
  maxRequests: Number(values["max-requests"]),
  maxCacheAgeDays: Number(values["max-cache-age-days"]),
});
const competitions = values.competitions ? values.competitions.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
const writeFile = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

async function buildMap() {
  const world = loadWorld(values["data-dir"]);
  const selected = competitions ?? coveredCompetitionIds(world);
  const existing = loadTeamMap(values["team-map"]);
  const built = await buildTeamMap({ client, world, competitions: selected, existing });
  const merged = { schemaVersion: 1, teams: { ...existing.teams, ...built.teams } };
  const summary = summarizeTeamMap({ teams: built.teams });
  for (const [id, counts] of Object.entries(summary)) console.log(`${id.padEnd(10)} mapped ${counts.mapped} unmapped ${counts.unmapped}`);
  if (values["dry-run"]) return;
  writeFile(values["team-map"], `${JSON.stringify(merged, null, 2)}\n`);
  log(`wrote ${values["team-map"]} (${client.stats.network} live requests)`);
}

async function refresh() {
  const result = await runRefresh({
    dataDir: values["data-dir"],
    teamMapPath: values["team-map"],
    idMapPath: values["id-map"],
    competitions,
    client,
    gateExceptions: loadGateExceptions(values["gate-exceptions"]),
    asOf: values["as-of"],
    log,
  });
  writeFile(values.report, result.report);
  const failed = result.gates.results.filter((g) => !g.ok);
  console.log(`players: ${result.summary.players} ops, staff: ${result.summary.staff} ops, unmapped teams: ${result.summary.unmapped}, unreadable pages: ${result.summary.unreadable}`);
  console.log(`gates: ${result.gates.results.length - failed.length}/${result.gates.results.length} passed${failed.length ? ` (FAILED: ${failed.map((g) => g.name).join(", ")})` : ""}`);
  console.log(`requests: ${client.stats.network} live, ${client.stats.cacheHits} cached; report: ${values.report}`);
  if (failed.length && !values["allow-gate-failures"]) {
    console.error("gate failure: overlay not written (use --allow-gate-failures to override)");
    process.exitCode = 1;
    return;
  }
  const explicitOut = values.out !== undefined;
  if (values["dry-run"] && !explicitOut) return;
  const out = values.out ?? path.join(ROOT, "assets/world/roster-overlay.json");
  writeFile(out, serializeOverlay(result.overlay));
  console.log(`overlay written: ${out}`);
  const keyPath = resolveKeyPath();
  if (fs.existsSync(keyPath)) {
    signOverlayFile(out, fs.readFileSync(keyPath, "utf8"));
    console.log(`overlay signed: ${out}.sig`);
  } else {
    console.error(`[world] WARNING: no signing key at ${keyPath}; ${out}.sig was NOT updated and the app will reject this overlay. Run "npm run world:keygen" or set OLM_OVERLAY_SIGNING_KEY, then "npm run world:sign".`);
  }
}

try {
  if (values.login) await loginFromFile(client, { log });
  if (values["build-team-map"]) await buildMap();
  else await refresh();
} catch (error) {
  console.error(`[world] ${error.name}: ${error.message}`);
  process.exitCode = 2;
}

