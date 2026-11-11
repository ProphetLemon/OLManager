// Pure aggregation of professional game builds into recommended builds and presence. No I/O.
//
// A raw row is one player-game from Leaguepedia ScoreboardPlayers: { gameId, champion, role, win, items, patch, date }
// where `items` is the list of item names at the end of the game.
import { itemKey } from "./ddragon-transform.mjs";

/**
 * Minimum games with item data for a champion and role to get a build of its own. Item frequencies are binomial
 * proportions: with 20 games the standard error of a 50% item is about 11 points, so the top five are barely stable
 * below that. It is also the sample the lane matchup script requires (DEFAULT_MIN_GAMES there).
 */
export const DEFAULT_MIN_GAMES = 20;
export const BUILD_SIZE = 5;
/** Item frequencies and cores kept per champion and role; the long tail adds size, not information. */
export const MAX_FREQUENCY_ENTRIES = 24;
export const MAX_CORES = 5;
export const CORE_SIZE = 3;

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Leaguepedia role labels to the lane-matchup script's canonical roles; null for anything else. */
export function canonicalRole(value) {
  const map = { top: "Top", jungle: "Jungle", mid: "Mid", bot: "Bot", support: "Support" };
  return map[String(value ?? "").trim().toLowerCase()] ?? null;
}

/** Decodes the entities Cargo leaves in text fields (`Zeke&#039;s Convergence`). */
export function decodeEntities(text) {
  return String(text ?? "").replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_, dec, hex, named) => {
    if (named) return HTML_ENTITIES[named.toLowerCase()];
    const code = dec ? Number(dec) : Number.parseInt(hex, 16);
    return Number.isSafeInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}

/** Item names of a `Items` field: semicolon separated, empty slots dropped. */
export function parseItemNames(raw) {
  return decodeEntities(raw)
    .split(";")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** Resolves a Leaguepedia champion name to a Data Dragon id through kits { id, name }. Null when unknown. */
export function createChampionResolver(champions) {
  const canonical = (value) => {
    const normalized = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalized === "wukong" ? "monkeyking" : normalized;
  };
  const byName = new Map();
  for (const { id, name } of champions) {
    byName.set(canonical(id), id);
    byName.set(canonical(name), id);
  }
  return (value) => byName.get(canonical(value)) ?? null;
}

/** Resolves an item name to a catalogue item through the same key style as the icon files. Null when unknown. */
export function createItemResolver(items) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  return (name) => byKey.get(itemKey(name)) ?? null;
}

/** Finished items: complete recipes, not boots, consumables, trinkets, starters or the support quest line. */
export function isFinishedItem(item) {
  return item.buildsInto.length === 0 && item.buildsFrom.length > 0 && !item.boots && !item.consumable && !item.trinket && !item.starter && !item.support;
}

/**
 * Maps raw rows to catalogue keys. Rows with an unknown champion or role are dropped (counted); item names that match no
 * catalogue item are listed in `unmappedItems` with their count and are not part of any build.
 * Returns { rows: [{ gameId, champion, role, win, patch, date, boots: key[], finished: key[], other: key[], hasItems }],
 *           unresolvedChampions, unmappedItems, droppedRows }.
 */
export function normalizeRows(rawRows, { resolveChampion, resolveItem }) {
  const rows = [];
  const unresolved = new Map();
  const unmapped = new Map();
  let droppedRows = 0;
  for (const raw of rawRows) {
    const role = canonicalRole(raw.role);
    const champion = raw.champion ? resolveChampion(raw.champion) : null;
    if (!role || !raw.gameId || typeof raw.win !== "boolean") {
      droppedRows += 1;
      continue;
    }
    if (!champion) {
      droppedRows += 1;
      if (raw.champion) unresolved.set(raw.champion, (unresolved.get(raw.champion) ?? 0) + 1);
      continue;
    }
    const boots = new Set();
    const finished = new Set();
    const other = new Set();
    const names = raw.items ?? [];
    for (const name of names) {
      const item = resolveItem(name);
      if (!item) {
        unmapped.set(name, (unmapped.get(name) ?? 0) + 1);
        continue;
      }
      if (item.boots) boots.add(item.key);
      else if (isFinishedItem(item)) finished.add(item.key);
      else other.add(item.key);
    }
    rows.push({
      gameId: raw.gameId,
      champion,
      role,
      win: raw.win,
      patch: raw.patch ?? null,
      date: raw.date ?? null,
      boots: [...boots].sort(),
      finished: [...finished].sort(),
      other: [...other].sort(),
      hasItems: names.length > 0,
    });
  }
  const byCount = (map) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    rows,
    droppedRows,
    unresolvedChampions: byCount(unresolved).map(([name, count]) => ({ name, count })),
    unmappedItems: byCount(unmapped).map(([name, count]) => ({ name, count })),
  };
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Entries of a count map as [key, count], most frequent first, ties by key. */
function ranked(map) {
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function triples(keys) {
  const out = [];
  for (let a = 0; a < keys.length; a += 1) {
    for (let b = a + 1; b < keys.length; b += 1) {
      for (let c = b + 1; c < keys.length; c += 1) out.push([keys[a], keys[b], keys[c]].join("+"));
    }
  }
  return out;
}

/**
 * Per champion and role: games, wins, games with item data, item frequencies (each item counted once per game),
 * boots frequencies and the most frequent cores (three finished items). Rows are expected from normalizeRows.
 * A game counts once per (champion, role); a champion appearing twice in one game and role is counted as given.
 */
export function aggregatePairs(rows) {
  const pairs = new Map();
  for (const row of rows) {
    const key = `${row.champion}::${row.role}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { champion: row.champion, role: row.role, games: 0, wins: 0, buildGames: 0, items: new Map(), boots: new Map(), cores: new Map() };
      pairs.set(key, pair);
    }
    pair.games += 1;
    if (row.win) pair.wins += 1;
    if (!row.hasItems) continue;
    pair.buildGames += 1;
    for (const item of row.finished) bump(pair.items, item);
    for (const item of row.boots) bump(pair.boots, item);
    for (const core of triples(row.finished)) bump(pair.cores, core);
  }
  return [...pairs.values()].sort((a, b) => a.champion.localeCompare(b.champion) || a.role.localeCompare(b.role));
}

/**
 * Recommended build of one pair: the most frequent boots and the BUILD_SIZE most frequent finished items, ordered by
 * how often they appear. Null when the pair is under the minimum sample or has no boots or fewer than 3 finished items.
 */
export function recommendBuild(pair, { minGames = DEFAULT_MIN_GAMES } = {}) {
  if (pair.buildGames < minGames) return null;
  const items = ranked(pair.items).slice(0, BUILD_SIZE);
  if (items.length < CORE_SIZE) return null;
  const boots = ranked(pair.boots)[0];
  return {
    boots: boots ? boots[0] : null,
    items: items.map(([key]) => key),
  };
}

const share = (count, total) => Math.round((count / total) * 1000) / 1000;

/**
 * Builds the champion map of the file. A pair under the minimum sample (or without enough items) gets
 * `build: null` and `fallback: "class"` plus the champion's class (its first Data Dragon tag), so consumers use the
 * class build. Frequencies are shares of `buildGames`.
 */
export function buildChampionEntries(pairs, { classOf, minGames = DEFAULT_MIN_GAMES }) {
  const champions = {};
  let withBuild = 0;
  let fallback = 0;
  for (const pair of pairs) {
    const build = recommendBuild(pair, { minGames });
    const entry = {
      games: pair.games,
      wins: pair.wins,
      buildGames: pair.buildGames,
      build,
    };
    if (build) {
      withBuild += 1;
      entry.itemShare = Object.fromEntries(ranked(pair.items).slice(0, MAX_FREQUENCY_ENTRIES).map(([key, count]) => [key, share(count, pair.buildGames)]));
      entry.bootsShare = Object.fromEntries(ranked(pair.boots).slice(0, 4).map(([key, count]) => [key, share(count, pair.buildGames)]));
      entry.commonCores = ranked(pair.cores)
        .slice(0, MAX_CORES)
        .map(([core, count]) => ({ items: core.split("+"), games: count }));
    } else {
      fallback += 1;
      entry.fallback = "class";
      entry.class = classOf(pair.champion);
    }
    champions[pair.champion] ??= {};
    champions[pair.champion][pair.role] = entry;
  }
  return { champions, pairs: { total: withBuild + fallback, withBuild, fallback } };
}

/** Counts of distinct games by patch label. */
export function gamesByPatch(rows) {
  const seen = new Map();
  for (const row of rows) if (!seen.has(row.gameId)) seen.set(row.gameId, row.patch ?? "unknown");
  const counts = new Map();
  for (const patch of seen.values()) bump(counts, patch);
  return Object.fromEntries([...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })));
}
