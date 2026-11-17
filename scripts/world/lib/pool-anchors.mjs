// The game's league ladder and the defaults of its rostered players, for rating the active-pros pool (A6f, method c).
//
// A pool player is anchored the way build-overrides.mjs anchors a rostered one: to `league_levels` (the median and sd of the authored
// OVR of the rostered players of each competition, placeholders left out). A pool player with no usable skill estimate takes the
// default of the league he last played in: the median authored OVR of the rostered players of that league who also have no usable
// estimate (matched but no estimate, or not linked to any stats). When a league has fewer than MIN_LEAGUE_DEFAULT_PLAYERS of them,
// the population of its game tier (1 top flight, 2 the rest) stands in. A pool player with no mapped league takes the tier-2
// population: a judgment default, see JUDGMENT_DEFAULT_TIER in pool-rating.mjs.
//
// `buildPoolAnchors` is pure. `loadPoolAnchors` runs the same build as `npm run stats:build` (scripts/stats/build-overrides.mjs)
// on the inputs of a pool run and hands its records to `buildPoolAnchors`.
import fs from "node:fs";
import { buildOverrides } from "../../stats/build-overrides.mjs";
import { DEFAULT_OVERLAY_FILE, loadGamePlayers } from "../../stats/lib/game-world.mjs";
import { isPlaceholder, median } from "../../stats/lib/levels.mjs";

/** Rostered players without an estimate a league needs before its own median is its default (the back-test's rule). */
export const MIN_LEAGUE_DEFAULT_PLAYERS = 10;

/**
 * @param {object} input
 * @param {Record<string, {median: number, sd: number}>} input.levels the fixed ladder (`league_levels`)
 * @param {Array<{id: string, reason: string|null, competitionMismatch?: boolean}>} input.records build-overrides records of the matched players
 * @param {Array<{id: string, team_id: string|null, competition: string|null, authoredOvr: number, isFlat50?: boolean, isAllZero?: boolean, attributes?: unknown}>} input.players the game's players
 * @param {Map<string, number>} input.tierOf game tier of each competition
 * @param {Record<string, string[]>} input.prefixes Leaguepedia tournament page prefixes by competition (scripts/stats/prefix-map.json)
 */
export function buildPoolAnchors({ levels, records, players, tierOf, prefixes }) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const population = [];
  for (const player of players) {
    if (!player.team_id || !player.competition || isPlaceholder(player)) continue;
    const record = byId.get(player.id);
    // Players with an estimate are the other group. A league mover keeps his rating and has no z in the record: in neither group.
    if (record && (record.reason === "kept_league_mover" || record.reason === null)) continue;
    population.push({ competition: player.competition, tier: tierOf.get(player.competition) ?? 2, ovr: player.authoredOvr });
  }
  const summarize = (list) => ({ median: median(list.map((p) => p.ovr)), n: list.length });
  const competitions = [...new Set(population.map((p) => p.competition))].sort();
  const leagueDefault = {};
  for (const competition of competitions) {
    const own = population.filter((p) => p.competition === competition);
    if (own.length >= MIN_LEAGUE_DEFAULT_PLAYERS) leagueDefault[competition] = summarize(own);
  }
  const tierDefault = {};
  for (const tier of [...new Set(population.map((p) => p.tier))].sort()) tierDefault[tier] = summarize(population.filter((p) => p.tier === tier));
  return { levels, prefixes, leagueDefault, tierDefault, tierOf: Object.fromEntries([...tierOf].filter(([id]) => levels[id]).sort(([a], [b]) => (a < b ? -1 : 1))) };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * The anchors of a pool run, from the inputs `npm run stats:build` reads: the per-game rows (`rows.json`, with its `since` and `until`),
 * the Leaguepedia player index next to it (`<rows>.players.json`), the game data with the committed roster overlay (only the rostered
 * players count; teamless pool adds never feed a level), the reviewed team map and pins.
 *
 * @param {object} input
 * @param {string} input.rowsFile
 * @param {string} [input.indexFile] default `<rowsFile>.players.json`
 * @param {string} input.dataDir
 * @param {string|null} [input.overlayFile] default assets/world/roster-overlay.json
 * @param {string} input.teamMapFile
 * @param {string|null} [input.pinsFile]
 * @param {string} input.prefixMapFile scripts/stats/prefix-map.json
 * @param {Map<string, number>} input.tierOf game tier of each competition (`world.competitions`)
 */
export function loadPoolAnchors({ rowsFile, indexFile = rowsFile.replace(/(\.json)?$/, ".players.json"), dataDir, overlayFile = DEFAULT_OVERLAY_FILE, teamMapFile, pinsFile = null, prefixMapFile, tierOf }) {
  const rows = readJson(rowsFile);
  if (!fs.existsSync(indexFile)) throw new Error(`pool anchors: the Leaguepedia player index ${indexFile} is missing (it is written next to rows.json by pro-stats.mjs)`);
  const { players } = loadGamePlayers({ dataDir, overlayFile });
  const { records, levels } = buildOverrides({
    rows: rows.rows, window: { since: rows.since, until: rows.until }, index: readJson(indexFile).players, players, teamMap: readJson(teamMapFile),
    pins: pinsFile && fs.existsSync(pinsFile) ? readJson(pinsFile) : {},
  });
  return buildPoolAnchors({ levels, records, players, tierOf, prefixes: readJson(prefixMapFile).competitions });
}
