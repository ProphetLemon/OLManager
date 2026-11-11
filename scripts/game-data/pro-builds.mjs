// Final builds and presence of champions in professional games, from Leaguepedia (Cargo tables ScoreboardPlayers and
// ScoreboardGames, CC BY-SA 3.0). Writes assets/simulation/champion-builds.v1.json.
//
//   node scripts/game-data/pro-builds.mjs --since 2025-11-12 --until 2026-11-12 [--offline] [--probe]
//        [--login] [--cache-dir <dir>] [--out <file>] [--min-games 20] [--max-requests 450] [--page-size 500]
//
// Same source and scope as scripts/champions/pro-matchups.mjs: every game of ScoreboardPlayers in the date window (no
// league filter), through the world tooling client (generic User-Agent, 4 s throttle, maxlag, retries, on-disk cache).
// Anonymous by default; --login uses the repository's bot-password helper exactly as pro-stats.mjs does (the helper
// reads the credentials file; this script never does). If Leaguepedia refuses, the run fails; no other host is tried. The cache is a local artifact (default src-tauri/target/olm-scratch/lp-builds-cache).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clampPageSize } from "../champions/pro-matchups.mjs";
import { loginFromFile } from "../world/lib/bot-credentials.mjs";
import { MediaWikiClient, formatStats } from "../world/lib/mediawiki-client.mjs";
import {
  DEFAULT_MIN_GAMES,
  aggregatePairs,
  buildChampionEntries,
  createChampionResolver,
  createItemResolver,
  gamesByPatch,
  normalizeRows,
  parseItemNames,
} from "./lib/pro-builds.mjs";
import { buildHeader } from "./lib/ddragon-transform.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = path.join(root, "src-tauri/target/olm-scratch");

export const SOURCE = "Leaguepedia ScoreboardPlayers + ScoreboardGames (CC BY-SA 3.0, https://lol.fandom.com)";
export const FIELDS = "SP.GameId=GameId,SP.Champion=Champion,SP.Role=Role,SP.PlayerWin=PlayerWin,SP.Items=Items,SG.Patch=Patch,SP.DateTime_UTC=DateTimeUtc";
/** Row order is total: a game has one row per side and role. Same order the pro-stats pull uses. */
export const ORDER_BY = "SP.GameId,SP.Side,SP.Role,SP.Name";

const HELP = `Usage: node scripts/game-data/pro-builds.mjs [flags]

  --since YYYY-MM-DD     first game date (required for a pull)
  --until YYYY-MM-DD     end date, exclusive (required for a pull)
  --probe                fetch one row, print it and stop (confirms the field names)
  --offline              read the cache only; fail on a miss
  --login                log in with the Leaguepedia bot password (opt-in; see scripts/champions/README.md, "Logging in");
                         ignored with --offline
  --cache-dir <dir>      HTTP cache (default src-tauri/target/olm-scratch/lp-builds-cache)
  --out <file>           builds file (default assets/simulation/champion-builds.v1.json)
  --min-games <n>        minimum games with item data for a build of its own (default ${DEFAULT_MIN_GAMES})
  --max-requests <n>     cap on live requests (default 450)
  --page-size <n>        Cargo page size (default and maximum 500)
  -h, --help             show this help
`;

export function parseArgs(argv) {
  const args = {
    since: null,
    until: null,
    probe: false,
    offline: false,
    login: false,
    cacheDir: path.join(scratch, "lp-builds-cache"),
    out: path.join(root, "assets/simulation/champion-builds.v1.json"),
    minGames: DEFAULT_MIN_GAMES,
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
    else if (flag === "--probe") args.probe = true;
    else if (flag === "--login") args.login = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--since") args.since = value(++i, flag);
    else if (flag === "--until") args.until = value(++i, flag);
    else if (flag === "--cache-dir") args.cacheDir = path.resolve(value(++i, flag));
    else if (flag === "--out") args.out = path.resolve(value(++i, flag));
    else if (flag === "--min-games") args.minGames = Number(value(++i, flag));
    else if (flag === "--max-requests") args.maxRequests = Number(value(++i, flag));
    else if (flag === "--page-size") args.pageSize = clampPageSize(value(++i, flag));
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Cargo params for one page. Dates are validated, so the WHERE clause cannot carry anything else. */
export function buildsParams({ since, until, offset, pageSize }) {
  if (!DATE.test(since ?? "") || !DATE.test(until ?? "") || since >= until) throw new Error(`invalid window ${since}..${until}`);
  return {
    action: "cargoquery",
    tables: "ScoreboardPlayers=SP,ScoreboardGames=SG",
    join_on: "SP.GameId=SG.GameId",
    fields: FIELDS,
    where: `SP.DateTime_UTC >= '${since}' AND SP.DateTime_UTC < '${until}'`,
    order_by: ORDER_BY,
    limit: String(pageSize),
    offset: String(offset),
  };
}

export function rowsFromCargo(data) {
  if (!data || !Array.isArray(data.cargoquery)) throw new Error("unexpected cargoquery answer: no cargoquery array");
  return data.cargoquery.map(({ title }) => ({
    gameId: title.GameId || null,
    champion: title.Champion || null,
    role: title.Role || null,
    win: title.PlayerWin === "Yes" ? true : title.PlayerWin === "No" ? false : null,
    items: parseItemNames(title.Items),
    patch: title.Patch || null,
    date: title.DateTimeUtc || null,
  }));
}

export async function fetchAllRows(client, args, log = () => {}) {
  const pageSize = clampPageSize(args.pageSize);
  const rows = [];
  for (let offset = 0, page = 1; ; offset += pageSize, page += 1) {
    const data = await client.get(buildsParams({ ...args, pageSize, offset }));
    const batch = rowsFromCargo(data);
    rows.push(...batch);
    if (page % 25 === 0) log(`page ${page}, ${rows.length} rows`);
    if (batch.length < pageSize) break;
  }
  return rows;
}

/** The whole file from raw rows. Pure: the clock and the network are outside. */
export function buildFile({ rawRows, items, kits, catalogueIds, args, pulledAt, patch }) {
  const kitList = Object.values(kits);
  const resolveChampion = createChampionResolver(kitList);
  const resolveItem = createItemResolver(items);
  const { rows, droppedRows, unresolvedChampions, unmappedItems } = normalizeRows(rawRows, { resolveChampion, resolveItem });
  const pairs = aggregatePairs(rows);
  const classOf = (id) => kits[id]?.tags?.[0] ?? null;
  const { champions, pairs: pairCounts } = buildChampionEntries(pairs, { classOf, minGames: args.minGames });
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  const games = new Set(rows.map((row) => row.gameId));
  return {
    ...buildHeader({ patch, date: pulledAt, kind: "champion-builds" }),
    source: SOURCE,
    generator: "scripts/game-data/pro-builds.mjs",
    itemsPatch: patch,
    leagues: "every game in Leaguepedia ScoreboardPlayers inside the date window (no league filter), the scope of scripts/champions/pro-matchups.mjs",
    since: args.since,
    until: args.until,
    firstGame: dates[0] ?? null,
    lastGame: dates[dates.length - 1] ?? null,
    patches: gamesByPatch(rows),
    games: games.size,
    rows: rows.length,
    droppedRows,
    minGames: args.minGames,
    minGamesRule: "games with item data needed for a build of its own; below it the pair is marked fallback: class",
    pairs: pairCounts,
    championsWithoutGames: catalogueIds.filter((id) => !(id in champions)).sort(),
    unresolvedChampions,
    unmappedItems,
    champions,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const log = (message) => console.error(`[pro-builds] ${message}`);
  const client = new MediaWikiClient({ cacheDir: args.cacheDir, offline: args.offline, maxRequests: args.maxRequests, maxCacheAgeDays: 30, log });
  try {
    if (args.login) await loginFromFile(client, { log });
    if (args.probe) {
      const data = await client.get(buildsParams({ since: args.since, until: args.until, offset: 0, pageSize: 1 }));
      console.log(JSON.stringify(data.cargoquery?.[0] ?? null, null, 2));
      return;
    }
    const itemsFile = JSON.parse(fs.readFileSync(path.join(root, "assets/simulation/items.v1.json"), "utf8"));
    const kitsFile = JSON.parse(fs.readFileSync(path.join(root, "assets/simulation/champion-kits.v1.json"), "utf8"));
    const catalogue = JSON.parse(fs.readFileSync(path.join(root, "assets/simulation/champion-list.json"), "utf8"));
    const rawRows = await fetchAllRows(client, args, log);
    const file = buildFile({
      rawRows,
      items: itemsFile.items,
      kits: kitsFile.champions,
      catalogueIds: catalogue.champions.map((champion) => champion.id),
      args,
      pulledAt: client.oldestFetchDate() ?? new Date().toISOString().slice(0, 10),
      patch: itemsFile.patch,
    });
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(file, null, 2)}\n`);
    log(`games=${file.games} rows=${file.rows} dropped=${file.droppedRows} pairs=${JSON.stringify(file.pairs)} unmappedItems=${file.unmappedItems.length} -> ${args.out}`);
  } finally {
    log(`requests: ${formatStats(client.stats)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[pro-builds] ${error.message}`);
    process.exitCode = 1;
  });
}
