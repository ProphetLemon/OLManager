// Pro-play lane matchup report from Leaguepedia (Cargo table ScoreboardPlayers, CC BY-SA 3.0).
//
//   node scripts/champions/pro-matchups.mjs --since 2025-01-01 [--until 2027-01-01] [--offline] [--login]
//        [--cache-dir <dir>] [--out <report.json>] [--min-games 20] [--min-lower-bound 0.5]
//        [--max-requests 800] [--page-size 500]
//
// Reuses the world tooling client (generic User-Agent, 4 s throttle, maxlag, retries, on-disk cache).
// The cache and the report are local artifacts: keep them outside git (default: src-tauri/target/olm-scratch).
// It never falls back to other hosts; if the Cargo API answers "ratelimited" or "forbidden" the run fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginFromFile } from "../world/lib/bot-credentials.mjs";
import { MediaWikiClient, formatStats } from "../world/lib/mediawiki-client.mjs";
import {
  DEFAULT_MIN_GAMES,
  DEFAULT_MIN_LOWER_BOUND,
  aggregateLaneMatchups,
  createChampionResolver,
  deriveCounterCandidates,
  findContradictions,
  roleDistribution,
} from "./lib/lane-matchups.mjs";

/** Leaguepedia Cargo returns at most 500 rows per query, whatever limit is requested. */
export const MAX_PAGE_SIZE = 500;

/** Integer page size in 1..MAX_PAGE_SIZE. A larger request would make a full page look short and end paging early. */
export function clampPageSize(value) {
  const size = Math.floor(Number(value));
  if (!Number.isFinite(size) || size < 1) throw new Error(`invalid page size ${value}`);
  return Math.min(size, MAX_PAGE_SIZE);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = path.join(root, "src-tauri/target/olm-scratch");

const HELP = `Usage: node scripts/champions/pro-matchups.mjs [flags]

  --since YYYY-MM-DD      first match date (default 2025-01-01)
  --until YYYY-MM-DD      end date, exclusive (default 2027-01-01)
  --offline               read the cache only; fail on a miss
  --login                 log in with a Leaguepedia bot password from ~/.config/olmanager/leaguepedia-bot.env
                          (opt-in; see scripts/champions/README.md, "Logging in"); ignored with --offline
  --cache-dir <dir>       HTTP cache (default src-tauri/target/olm-scratch/lp-cargo-cache)
  --out <file>            report path (default src-tauri/target/olm-scratch/pro-matchups-report.json)
  --min-games <n>         minimum games per matchup
  --min-lower-bound <x>   minimum Wilson lower bound
  --max-requests <n>      cap on live requests (default 800)
  --page-size <n>         Cargo page size (default and maximum 500)
  -h, --help              show this help
`;

export function parseArgs(argv) {
  const args = {
    since: "2025-01-01",
    until: "2027-01-01",
    offline: false,
    cacheDir: path.join(scratch, "lp-cargo-cache"),
    out: path.join(scratch, "pro-matchups-report.json"),
    minGames: DEFAULT_MIN_GAMES,
    minLowerBound: DEFAULT_MIN_LOWER_BOUND,
    maxRequests: 800,
    pageSize: 500,
    login: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--offline") args.offline = true;
    else if (flag === "--login") args.login = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--since") args.since = argv[++i];
    else if (flag === "--until") args.until = argv[++i];
    else if (flag === "--cache-dir") args.cacheDir = path.resolve(argv[++i]);
    else if (flag === "--out") args.out = path.resolve(argv[++i]);
    else if (flag === "--min-games") args.minGames = Number(argv[++i]);
    else if (flag === "--min-lower-bound") args.minLowerBound = Number(argv[++i]);
    else if (flag === "--max-requests") args.maxRequests = Number(argv[++i]);
    else if (flag === "--page-size") args.pageSize = clampPageSize(argv[++i]);
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

/**
 * Cargo query for one page. Offset pagination needs a total order.
 * (GameId, Role, PlayerWin) is unique per row: a game has one winner and one loser per role.
 * Checked on the 2025-01-01..2027-01-01 pass (528 full pages plus one of 390 rows, 264,390 rows): no repeated key,
 * so no tiebreaker column is needed. It is a data property, not a schema guarantee; if a pass ever
 * reports duplicate keys, append a per-player column such as Link to order_by.
 */
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

export async function fetchAllRows(client, args) {
  const pageSize = clampPageSize(args.pageSize);
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const data = await client.get(scoreboardParams({ ...args, pageSize, offset }));
    const page = rowsFromCargo(data);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const log = (message) => console.error(`[pro-matchups] ${message}`);
  const client = new MediaWikiClient({ cacheDir: args.cacheDir, offline: args.offline, maxRequests: args.maxRequests, maxCacheAgeDays: 30, log });
  try {
    await run(args, client, log);
  } finally {
    // Printed on success and on failure; errors thrown by the client also carry `stats`.
    log(`requests: ${formatStats(client.stats)}`);
  }
}

async function run(args, client, log) {
  if (args.login) await loginFromFile(client, { log });
  const fetched = await fetchAllRows(client, args);
  const championList = JSON.parse(fs.readFileSync(path.join(root, "assets/simulation/champion-list.json"), "utf8")).champions;
  const resolve = createChampionResolver(championList);
  const unresolved = new Set();
  const rows = [];
  for (const row of fetched) {
    const champion = row.champion ? resolve(row.champion) : null;
    if (champion) rows.push({ ...row, champion });
    else if (row.champion) unresolved.add(row.champion);
  }
  if (unresolved.size > 0) console.warn(`[pro-matchups] ${unresolved.size} champion names did not resolve and were skipped: ${[...unresolved].sort().join(", ")}`);
  const { matchups, skipped, laneGames } = aggregateLaneMatchups(rows);
  const options = { minGames: args.minGames, minLowerBound: args.minLowerBound };
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
    unresolvedChampions: [...unresolved].sort(),
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
