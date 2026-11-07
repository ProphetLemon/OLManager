// Pro-play lane matchup report from Leaguepedia (Cargo table ScoreboardPlayers, CC BY-SA 3.0).
//
//   node scripts/champions/pro-matchups.mjs --since 2025-01-01 [--until 2027-01-01] [--offline]
//        [--cache-dir <dir>] [--out <report.json>] [--min-games 12] [--min-win-rate 0.55]
//        [--max-requests 800] [--page-size 500]
//
// Reuses the world tooling client (generic User-Agent, 4 s throttle, maxlag, retries, on-disk cache).
// The cache and the report are local artifacts: keep them outside git (default: src-tauri/target/olm-scratch).
// It never falls back to other hosts; if the Cargo API answers "ratelimited" or "forbidden" the run fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MediaWikiClient } from "../world/lib/mediawiki-client.mjs";
import {
  DEFAULT_MIN_GAMES,
  DEFAULT_MIN_WIN_RATE,
  aggregateLaneMatchups,
  deriveCounterCandidates,
  findContradictions,
  roleDistribution,
} from "./lib/lane-matchups.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = path.join(root, "src-tauri/target/olm-scratch");

function parseArgs(argv) {
  const args = {
    since: "2025-01-01",
    until: "2027-01-01",
    offline: false,
    cacheDir: path.join(scratch, "lp-cargo-cache"),
    out: path.join(scratch, "pro-matchups-report.json"),
    minGames: DEFAULT_MIN_GAMES,
    minWinRate: DEFAULT_MIN_WIN_RATE,
    maxRequests: 800,
    pageSize: 500,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--offline") args.offline = true;
    else if (flag === "--since") args.since = argv[++i];
    else if (flag === "--until") args.until = argv[++i];
    else if (flag === "--cache-dir") args.cacheDir = path.resolve(argv[++i]);
    else if (flag === "--out") args.out = path.resolve(argv[++i]);
    else if (flag === "--min-games") args.minGames = Number(argv[++i]);
    else if (flag === "--min-win-rate") args.minWinRate = Number(argv[++i]);
    else if (flag === "--max-requests") args.maxRequests = Number(argv[++i]);
    else if (flag === "--page-size") args.pageSize = Number(argv[++i]);
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

/** Cargo query for one page. Ordered by a unique key so offset pagination is stable. */
export function scoreboardParams({ since, until, offset, pageSize }) {
  return {
    action: "cargoquery",
    tables: "ScoreboardPlayers",
    fields: "GameId,Champion,Role,PlayerWin",
    where: `DateTime_UTC >= '${since}' AND DateTime_UTC < '${until}'`,
    order_by: "GameId,Role,PlayerWin",
    limit: String(pageSize),
    offset: String(offset),
  };
}

export function rowsFromCargo(data) {
  return (data.cargoquery ?? []).map(({ title }) => ({
    gameId: title.GameId,
    champion: title.Champion,
    role: title.Role,
    win: title.PlayerWin === "Yes",
  }));
}

async function fetchAllRows(client, args) {
  const rows = [];
  for (let offset = 0; ; offset += args.pageSize) {
    const data = await client.get(scoreboardParams({ ...args, offset }));
    const page = rowsFromCargo(data);
    rows.push(...page);
    if (page.length < args.pageSize) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new MediaWikiClient({ cacheDir: args.cacheDir, offline: args.offline, maxRequests: args.maxRequests, maxCacheAgeDays: 30 });
  const rows = await fetchAllRows(client, args);
  const { matchups, skipped, laneGames } = aggregateLaneMatchups(rows);
  const options = { minGames: args.minGames, minWinRate: args.minWinRate };
  const candidates = deriveCounterCandidates(matchups, options);
  const curation = JSON.parse(fs.readFileSync(path.join(root, "assets/simulation/champions.json"), "utf8"));
  const existing = curation.data.counterpicks.map(({ a, b, value }) => ({ source: a.toLowerCase().replace(/[^a-z0-9]/g, ""), target: b.toLowerCase().replace(/[^a-z0-9]/g, ""), value }));
  const contradictions = findContradictions(existing, matchups, options);
  const report = {
    source: "Leaguepedia ScoreboardPlayers (CC BY-SA 3.0, https://lol.fandom.com)",
    since: args.since,
    until: args.until,
    thresholds: options,
    rows: rows.length,
    laneGames,
    skippedSlots: skipped,
    network: client.stats,
    candidates,
    contradictions,
    roleDistribution: roleDistribution(rows),
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[pro-matchups] rows=${rows.length} laneGames=${laneGames} skipped=${skipped} candidates=${candidates.length} contradictions=${contradictions.length} -> ${args.out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[pro-matchups] ${error.message}`);
    process.exitCode = 1;
  });
}
