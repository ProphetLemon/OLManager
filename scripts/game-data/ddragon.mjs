// Item catalogue and champion kits from Riot's Data Dragon (static game data).
//
//   node scripts/game-data/ddragon.mjs [--version 16.22.1] [--offline] [--no-icons]
//        [--cache-dir <dir>] [--out-dir assets/simulation] [--icons-dir public]
//        [--throttle-ms 1000] [--max-requests 800]
//
// Writes assets/simulation/items.v1.json and assets/simulation/champion-kits.v1.json, and the icon files the live
// match shows (public/lol-item-icons, lol-summoner-icons, lol-ultimate-icons). Read-only GETs to
// ddragon.leagueoflegends.com only, one at a time, cached under src-tauri/target/olm-scratch (never committed).
// Rerunning with --offline from the cache gives the same files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DdragonClient, VERSIONS_MAX_AGE_MS, formatStats } from "./lib/ddragon-fetch.mjs";
import { buildHeader, buildItems, buildKits } from "./lib/ddragon-transform.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = path.join(root, "src-tauri/target/olm-scratch");

/** Summoner spells the live view shows, by the game's spell key. */
export const SUMMONER_SPELLS = {
  flash: "SummonerFlash",
  ignite: "SummonerDot",
  heal: "SummonerHeal",
  smite: "SummonerSmite",
  teleport: "SummonerTeleport",
};

const HELP = `Usage: node scripts/game-data/ddragon.mjs [flags]

  --version <v>        Data Dragon patch (default: newest in api/versions.json)
  --offline            read the cache only; fail on a miss
  --no-icons           write the two data files only
  --cache-dir <dir>    raw download cache (default src-tauri/target/olm-scratch/ddragon-cache; never commit it)
  --out-dir <dir>      data files (default assets/simulation)
  --icons-dir <dir>    public directory for icons (default public)
  --throttle-ms <n>    gap between live requests (default 1000)
  --max-requests <n>   cap on live requests (default 800)
  -h, --help           show this help
`;

export function parseArgs(argv) {
  const args = {
    version: null,
    offline: false,
    icons: true,
    cacheDir: path.join(scratch, "ddragon-cache"),
    outDir: path.join(root, "assets/simulation"),
    iconsDir: path.join(root, "public"),
    throttleMs: 1000,
    maxRequests: 800,
    help: false,
  };
  const value = (i, flag) => {
    if (i >= argv.length || argv[i].startsWith("--")) throw new Error(`${flag} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--offline") args.offline = true;
    else if (flag === "--no-icons") args.icons = false;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--version") args.version = value(++i, flag);
    else if (flag === "--cache-dir") args.cacheDir = path.resolve(value(++i, flag));
    else if (flag === "--out-dir") args.outDir = path.resolve(value(++i, flag));
    else if (flag === "--icons-dir") args.iconsDir = path.resolve(value(++i, flag));
    else if (flag === "--throttle-ms") args.throttleMs = Number(value(++i, flag));
    else if (flag === "--max-requests") args.maxRequests = Number(value(++i, flag));
    else throw new Error(`unknown flag ${flag}`);
  }
  if (args.version !== null && !/^\d+\.\d+\.\d+$/.test(args.version)) throw new Error(`invalid --version ${args.version}`);
  return args;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Copies a PNG into the public directory; an existing file is kept (its name is part of the app). */
function installIcon(client, bytes, file, counters) {
  if (fs.existsSync(file)) {
    counters.kept += 1;
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  counters.written += 1;
}

async function downloadIcons({ client, args, patch, items, champions, summoner, log }) {
  const counters = { item: { kept: 0, written: 0 }, summoner: { kept: 0, written: 0 }, ultimate: { kept: 0, written: 0 } };
  for (const item of items) {
    const file = path.join(args.iconsDir, item.icon);
    if (fs.existsSync(file)) {
      counters.item.kept += 1;
      continue;
    }
    installIcon(client, await client.png(`cdn/${patch}/img/item/${item.id}.png`), file, counters.item);
  }
  for (const [spell, id] of Object.entries(SUMMONER_SPELLS)) {
    const image = summoner.data?.[id]?.image?.full;
    if (image !== `${id}.png`) throw new Error(`summoner.json has no ${id} for ${spell}`);
    installIcon(client, await client.png(`cdn/${patch}/img/spell/${image}`), path.join(args.iconsDir, "lol-summoner-icons", image), counters.summoner);
  }
  for (const kit of Object.values(champions)) {
    if (!kit.ultimate.icon) continue;
    const image = path.basename(kit.ultimate.icon);
    installIcon(client, await client.png(`cdn/${patch}/img/spell/${image}`), path.join(args.iconsDir, kit.ultimate.icon), counters.ultimate);
  }
  log(`icons: ${JSON.stringify(counters)}`);
  return counters;
}

export async function run(args, client, log) {
  const versions = await client.json("api/versions.json", { maxAgeMs: VERSIONS_MAX_AGE_MS });
  if (!Array.isArray(versions) || versions.length === 0) throw new Error("api/versions.json is not a list");
  const patch = args.version ?? versions[0];
  if (!versions.includes(patch)) throw new Error(`Data Dragon has no patch ${patch}`);
  const base = `cdn/${patch}/data/en_US`;
  const itemJson = await client.json(`${base}/item.json`);
  const championFull = await client.json(`${base}/championFull.json`);
  const summoner = await client.json(`${base}/summoner.json`);
  if (itemJson.version !== patch || championFull.version !== patch) throw new Error(`downloaded data is not patch ${patch}`);

  const catalogue = JSON.parse(fs.readFileSync(path.join(root, "assets/simulation/champion-list.json"), "utf8"));
  const date = client.fetchedDate(`${base}/item.json`) ?? new Date().toISOString().slice(0, 10);

  const { items, filter } = buildItems(itemJson);
  const { champions, report } = buildKits(championFull, catalogue.champions.map((champion) => champion.id));
  if (report.missingFromData.length > 0) throw new Error(`catalogue champions missing from Data Dragon: ${report.missingFromData.join(", ")}`);

  const itemKeys = new Set(items.map((item) => item.key));
  const iconDir = path.join(args.iconsDir, "lol-item-icons");
  const legacyKeys = fs.existsSync(iconDir) ? fs.readdirSync(iconDir).filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)) : [];
  const retiredKeys = legacyKeys.filter((key) => !itemKeys.has(key)).sort();

  writeJson(path.join(args.outDir, "items.v1.json"), {
    ...buildHeader({ patch, date, kind: "items" }),
    filter,
    retiredKeys,
    items,
  });
  writeJson(path.join(args.outDir, "champion-kits.v1.json"), {
    ...buildHeader({ patch, date, kind: "champion-kits" }),
    catalogueVersion: catalogue.version,
    championsNotInCatalogue: report.notInCatalogue,
    champions,
  });
  log(`patch ${patch} (catalogue ${catalogue.version}); items kept ${filter.kept}, dropped ${filter.dropped} ${JSON.stringify(filter.droppedByReason)}`);
  log(`champions ${report.total}, in catalogue ${report.inCatalogue}, not in catalogue: ${report.notInCatalogue.join(", ") || "none"}`);
  log(`retired keys (icon exists, item is not in the catalogue): ${retiredKeys.join(", ") || "none"}`);
  if (args.icons) await downloadIcons({ client, args, patch, items, champions, summoner, log });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const log = (message) => console.error(`[ddragon] ${message}`);
  const client = new DdragonClient({ cacheDir: args.cacheDir, offline: args.offline, throttleMs: args.throttleMs, maxRequests: args.maxRequests, log });
  try {
    await run(args, client, log);
  } finally {
    log(`requests: ${formatStats(client.stats)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[ddragon] ${error.message}`);
    process.exitCode = 1;
  });
}
