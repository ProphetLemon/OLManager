// Per-game pro stats from Leaguepedia (Cargo tables ScoreboardPlayers + ScoreboardGames, CC BY-SA 3.0)
// for the stat-derived player ratings.
//
//   node scripts/stats/pro-stats.mjs [--since 2025-01-01] [--until 2027-01-01] [--competitions lck,lec]
//        [--offline] [--login] [--cache-dir <dir>] [--out <rows.json>] [--max-requests 450] [--page-size 500]
//
// Competition by competition, page by page; every page is cached, so a rerun resumes where the last one stopped.
// Data: Leaguepedia (lol.fandom.com), CC BY-SA 3.0. Outputs stay in src-tauri/target/olm-scratch (never commit them).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginFromFile } from "../world/lib/bot-credentials.mjs";
import { MediaWikiClient, formatStats } from "../world/lib/mediawiki-client.mjs";
import { normalizeRows } from "./lib/normalize.mjs";
import { MAX_PAGE_SIZE, isValidIsoDate, rowsFromCargo, scoreboardPageParams } from "./lib/queries.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = path.join(root, "src-tauri/target/olm-scratch");
const PREFIX_MAP_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "prefix-map.json");

export const SOURCE = "Leaguepedia ScoreboardPlayers + ScoreboardGames (CC BY-SA 3.0, https://lol.fandom.com)";

const HELP = `Usage: node scripts/stats/pro-stats.mjs [flags]

  --since YYYY-MM-DD      first game date (default 2025-01-01)
  --until YYYY-MM-DD      end date, exclusive (default 2027-01-01)
  --competitions <ids>    comma-separated OLManager competition ids (default: all mapped in prefix-map.json)
  --offline               read the cache only; fail on a miss
  --login                 log in with the Leaguepedia bot password (opt-in; see scripts/champions/README.md,
                          "Logging in"); ignored with --offline
  --cache-dir <dir>       HTTP cache (default src-tauri/target/olm-scratch/lp-stats-cache)
  --out <file>            normalized rows (default src-tauri/target/olm-scratch/stat-ratings/rows.json);
                          the coverage report is written next to it as <name>.coverage.json
  --max-requests <n>      cap on live requests (default 450)
  --page-size <n>         Cargo page size (default 500, max ${MAX_PAGE_SIZE})
  -h, --help              show this help
`;

export function loadPrefixMap(file = PREFIX_MAP_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function parseArgs(argv, prefixMap = loadPrefixMap()) {
  const args = {
    since: "2025-01-01",
    until: "2027-01-01",
    competitions: null,
    offline: false,
    login: false,
    cacheDir: path.join(scratch, "lp-stats-cache"),
    out: path.join(scratch, "stat-ratings/rows.json"),
    maxRequests: 450,
    pageSize: 500,
    help: false,
  };
  const value = (i, flag) => {
    if (i >= argv.length || argv[i].startsWith("--")) throw new Error(`${flag} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--offline") args.offline = true;
    else if (flag === "--login") args.login = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--since") args.since = value(++i, flag);
    else if (flag === "--until") args.until = value(++i, flag);
    else if (flag === "--competitions") args.competitions = value(++i, flag).split(",").map((id) => id.trim()).filter(Boolean);
    else if (flag === "--cache-dir") args.cacheDir = path.resolve(value(++i, flag));
    else if (flag === "--out") args.out = path.resolve(value(++i, flag));
    else if (flag === "--max-requests") args.maxRequests = Number(value(++i, flag));
    else if (flag === "--page-size") args.pageSize = Number(value(++i, flag));
    else throw new Error(`unknown flag ${flag}`);
  }
  if (args.help) return args;
  if (!isValidIsoDate(args.since)) throw new Error(`--since must be a real YYYY-MM-DD date, got ${args.since}`);
  if (!isValidIsoDate(args.until)) throw new Error(`--until must be a real YYYY-MM-DD date, got ${args.until}`);
  if (args.since >= args.until) throw new Error("--since must be earlier than --until");
  if (!Number.isInteger(args.maxRequests) || args.maxRequests < 1) throw new Error("--max-requests must be a positive integer");
  if (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > MAX_PAGE_SIZE) throw new Error(`--page-size must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  const mapped = Object.keys(prefixMap.competitions).sort();
  const wanted = args.competitions ?? mapped;
  const unknown = wanted.filter((id) => !mapped.includes(id));
  if (unknown.length > 0) throw new Error(`unmapped competition id(s): ${unknown.join(", ")} (mapped: ${mapped.join(", ")})`);
  args.competitions = [...new Set(wanted)].sort();
  return args;
}

/** All raw rows of one competition; stops at the first page shorter than the page size. */
export async function fetchCompetitionRows(client, { prefixes, since, until, pageSize, log = () => {} }) {
  const rows = [];
  for (let offset = 0, page = 1; ; offset += pageSize, page += 1) {
    const data = await client.get(scoreboardPageParams({ since, until, prefixes, offset, pageSize }));
    const batch = rowsFromCargo(data);
    log(`  page ${page}: ${batch.length} rows`);
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

/** Where the coverage report goes: next to the rows file, `<name>.coverage.json`. */
export function coveragePath(out) {
  return out.replace(/(\.json)?$/, ".coverage.json");
}

/** Fetches, normalizes and writes rows plus coverage. Returns { rows, coverage }. */
export async function runProStats(args, client, log, prefixMap = loadPrefixMap()) {
  if (args.login && !args.offline) await loginFromFile(client, { log });
  const allRows = [];
  const competitions = {};
  for (const id of args.competitions) {
    log(`${id}: fetching ${prefixMap.competitions[id].join(", ")}`);
    const raw = await fetchCompetitionRows(client, { prefixes: prefixMap.competitions[id], since: args.since, until: args.until, pageSize: args.pageSize, log });
    const { rows, dropped, stats } = normalizeRows(raw, { competition: id });
    competitions[id] = { games: stats.games, rows: stats.rows, players: stats.players, inputRows: stats.inputRows, dropped };
    allRows.push(...rows);
    log(`${id}: ${stats.games} games, ${stats.rows}/${stats.inputRows} rows kept, ${stats.players} players`);
  }
  const coverage = {
    source: SOURCE,
    since: args.since,
    until: args.until,
    competitions,
    totals: {
      rows: allRows.length,
      games: Object.values(competitions).reduce((sum, c) => sum + c.games, 0),
      inputRows: Object.values(competitions).reduce((sum, c) => sum + c.inputRows, 0),
    },
    open: prefixMap.open ?? {},
    network: client.statsSnapshot ? client.statsSnapshot() : client.stats,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify({ source: SOURCE, since: args.since, until: args.until, competitions: args.competitions, rows: allRows }, null, 2)}\n`);
  fs.writeFileSync(coveragePath(args.out), `${JSON.stringify(coverage, null, 2)}\n`);
  log(`wrote ${allRows.length} rows -> ${args.out}`);
  return { rows: allRows, coverage };
}

async function main() {
  const log = (message) => console.error(`[pro-stats] ${message}`);
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[pro-stats] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(HELP);
    return;
  }
  const client = new MediaWikiClient({ cacheDir: args.cacheDir, offline: args.offline, maxRequests: args.maxRequests, maxCacheAgeDays: 30, log });
  try {
    await runProStats(args, client, log);
  } catch (error) {
    if (error?.name === "RequestBudgetExceededError") log("request budget exhausted: rerun the same command to resume from the cache");
    throw error;
  } finally {
    log(`requests: ${formatStats(client.stats)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[pro-stats] ${error.message}`);
    process.exitCode = 1;
  });
}
