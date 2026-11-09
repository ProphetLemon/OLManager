// Builds assets/world/player-rating-overrides.json (the stat-derived rating overrides) and a before/after report.
//
//   node scripts/stats/build-overrides.mjs [--rows <rows.json>] [--players <rows.players.json>] [--data <dir>]
//        [--overlay <file>] [--team-map <file>] [--pins <file>] [--out <asset>] [--report-dir <dir>] [--include-placeholders]
//
// Inputs: rows and the per-Link index written by pro-stats.mjs, the game world (./data plus the roster overlay),
// scripts/world/team-map.json and scripts/stats/pins.json. Offline and deterministic: no clock, no network.
// Data: Leaguepedia (lol.fandom.com), CC BY-SA 3.0.
//
// Pipeline: league ladder (fixed, from authored OVR) -> identity match -> estimateSkill over all rows (fallback cohort
// pools by 5-point level buckets) -> per matched player the cohort with the most effective games decides the stat
// competition -> blendRating on that competition's level -> deriveAttributes. Only matched players with an estimate
// get an entry, and only when the attributes actually change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAttributes } from "./lib/attributes.mjs";
import { ATTRIBUTE_NAMES, DEFAULT_DATA_DIR, DEFAULT_OVERLAY_FILE, loadGamePlayers } from "./lib/game-world.mjs";
import { matchPlayers } from "./lib/identity.mjs";
import { leagueLevelStats, poolOfLevels } from "./lib/levels.mjs";
import { blendRating, estimateSkill, isSuspect } from "./lib/skill.mjs";
import { compactKey } from "../world/lib/text.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const scratch = path.join(root, "src-tauri/target/olm-scratch/stat-ratings");

export const ASSET_VERSION = 1;
export const METHOD = "stat-blend-v1";
export const SOURCE = "Leaguepedia ScoreboardPlayers and ScoreboardGames (lol.fandom.com), CC BY-SA 3.0";
export const THRESHOLDS = Object.freeze([65, 70, 80]);
export const SPOTLIGHT = Object.freeze(["Boal", "Minous", "Winner"]);

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

/** The estimate that decides a matched player: most effective games, then most raw games, then competition id. */
function bestEstimate(estimates) {
  return [...estimates].sort((a, b) => b.effectiveGames - a.effectiveGames || b.games - a.games || compare(a.competition, b.competition))[0] ?? null;
}

/**
 * @param input.rows skill GameRows (rows.json `rows`)
 * @param input.window { since, until } of the rows
 * @param input.index Leaguepedia index (players.json `players`)
 * @param input.players game players (loadGamePlayers)
 * @param input.teamMap parsed team-map.json
 * @param input.pins parsed pins.json
 * @param input.includePlaceholders also write entries for flat-50 and all-zero rows (blended from the league median, as suspect)
 * @returns {asset, report}
 */
export function buildOverrides({ rows, window, index, players, teamMap, pins = {}, includePlaceholders = false }) {
  const { levels, counts } = leagueLevelStats(players);
  const identity = matchPlayers({ index, players, teamMap, pins });
  const playerById = new Map(players.map((p) => [p.id, p]));
  const linkOf = new Map(identity.matches.map((m) => [m.playerId, m]));
  const referenceDate = rows.reduce((max, r) => (r.date > max ? r.date : max), "1970-01-01");
  const estimates = estimateSkill(rows, { referenceDate, poolOf: poolOfLevels(levels) });
  const byLink = new Map();
  for (const est of estimates) {
    if (!byLink.has(est.playerKey)) byLink.set(est.playerKey, []);
    byLink.get(est.playerKey).push(est);
  }

  const records = [];
  const entries = [];
  const noEstimate = {};
  for (const match of identity.matches) {
    const player = playerById.get(match.playerId);
    const placeholder = player.isFlat50 || player.isAllZero;
    const own = levels[player.competition];
    const base = { id: player.id, matchName: player.match_name, link: match.link, via: match.via, teamId: player.team_id, competition: player.competition, authoredOvr: player.authoredOvr, placeholder };
    const all = byLink.get(match.link) ?? [];
    const usable = all.filter((e) => e.reason === null && levels[e.competition]);
    const best = bestEstimate(usable);
    if (!best) {
      const reason = all.length === 0 ? "no_rows" : bestEstimate(all)?.reason === null ? "no_league_level" : bestEstimate(all).reason;
      noEstimate[reason] = (noEstimate[reason] ?? 0) + 1;
      records.push({ ...base, reason });
      continue;
    }
    if (placeholder && !includePlaceholders) {
      noEstimate.placeholder_skipped = (noEstimate.placeholder_skipped ?? 0) + 1;
      records.push({ ...base, reason: "placeholder_skipped", statCompetition: best.competition });
      continue;
    }
    // Stats only place a player inside his league: the target level is the league he plays in now, the stat
    // competition's level is only the fallback when he has no current competition or it has no level.
    const statLevel = levels[best.competition];
    const gameLevel = player.competition ? levels[player.competition] : undefined;
    const level = gameLevel ?? statLevel;
    const levelUsed = gameLevel ? "game" : "stat";
    // A placeholder has no rating data of its own: its baseline is the median of its league, and it is always suspect.
    const baseline = placeholder ? (own?.median ?? level.median) : player.authoredOvr;
    const suspect = placeholder || isSuspect({ attributes: player.attributes, authoredOvr: player.authoredOvr, leagueMedian: own?.median });
    const blend = blendRating({ authoredOvr: baseline, leagueMedian: level.median, leagueSd: level.sd, z: best.z, rho: best.rho, suspect });
    if (!blend) {
      noEstimate.not_blendable = (noEstimate.not_blendable ?? 0) + 1;
      records.push({ ...base, reason: "not_blendable" });
      continue;
    }
    const derived = deriveAttributes({ attributes: player.attributes, authoredOvr: baseline, finalOvr: blend.finalOvr, games: best.games, potentialBase: player.potential_base });
    const record = {
      ...base,
      reason: null,
      role: best.role,
      statCompetition: best.competition,
      gameCompetition: player.competition,
      competitionMismatch: player.competition !== null && best.competition !== player.competition,
      statLevel: statLevel.median,
      gameLevel: gameLevel?.median ?? null,
      levelUsed,
      games: best.games,
      effectiveGames: round(best.effectiveGames, 2),
      cohort: best.cohort,
      z: round(blend.z, 3),
      rho: round(blend.rho, 3),
      target: round(blend.target, 2),
      confidence: round(blend.w, 4),
      suspect,
      finalOvr: round(blend.finalOvr, 2),
      newOvr: derived.newOvr,
      delta: derived.newOvr - player.authoredOvr,
      measured: derived.measured,
    };
    records.push(record);
    const changed = ATTRIBUTE_NAMES.some((name) => derived.attributes[name] !== player.attributes[name]);
    if (changed) {
      entries.push({
        id: player.id,
        authored_ovr: player.authoredOvr,
        games: best.games,
        confidence: record.confidence,
        attributes: derived.attributes,
        potential_floor: derived.potentialFloor,
      });
    }
  }
  entries.sort((a, b) => compare(a.id, b.id));

  const asset = { version: ASSET_VERSION, method: METHOD, source: SOURCE, window: { since: window.since, until: window.until }, league_levels: levels, entries };
  return { asset, report: buildReport({ levels, counts, players, identity, records, entries, noEstimate, window, referenceDate, estimates }) };
}

function buildReport({ levels, counts, players, identity, records, entries, noEstimate, window, referenceDate, estimates }) {
  const estimated = records.filter((r) => r.reason === null);
  const entryIds = new Set(entries.map((e) => e.id));
  const matchedIds = new Set(identity.matches.map((m) => m.playerId));
  const competitions = [...new Set(players.filter((p) => p.competition && p.team_id).map((p) => p.competition))].sort(compare).map((competition) => {
    const roster = players.filter((p) => p.competition === competition && p.team_id);
    const done = estimated.filter((r) => r.competition === competition);
    const abs = done.map((r) => Math.abs(r.delta));
    return {
      competition,
      players: roster.length,
      matched: roster.filter((p) => matchedIds.has(p.id)).length,
      estimated: done.length,
      entries: done.filter((r) => entryIds.has(r.id)).length,
      meanAbsDelta: abs.length ? round(abs.reduce((s, v) => s + v, 0) / abs.length, 2) : 0,
      maxAbsDelta: abs.length ? Math.max(...abs) : 0,
    };
  });
  const thresholds = THRESHOLDS.map((ovr) => ({
    ovr,
    up: estimated.filter((r) => r.authoredOvr < ovr && r.newOvr >= ovr).length,
    down: estimated.filter((r) => r.authoredOvr >= ovr && r.newOvr < ovr).length,
  }));
  const slim = (r) => ({ id: r.id, matchName: r.matchName, link: r.link, competition: r.competition, statCompetition: r.statCompetition, role: r.role, games: r.games, authoredOvr: r.authoredOvr, newOvr: r.newOvr, delta: r.delta, confidence: r.confidence, suspect: r.suspect });
  const byDelta = [...estimated].sort((a, b) => b.delta - a.delta || compare(a.id, b.id));
  const suspects = players
    .filter((p) => p.team_id && !p.isFlat50 && !p.isAllZero && isSuspect({ attributes: p.attributes, authoredOvr: p.authoredOvr, leagueMedian: levels[p.competition]?.median }))
    .map((p) => {
      const r = records.find((x) => x.id === p.id);
      return { id: p.id, matchName: p.match_name, competition: p.competition, authoredOvr: p.authoredOvr, status: !r ? "unmatched" : r.reason === null ? "estimated" : r.reason, newOvr: r?.newOvr ?? null, confidence: r?.confidence ?? null };
    });
  const spotlight = SPOTLIGHT.map((query) => {
    const found = players.filter((p) => compactKey(p.match_name) === compactKey(query));
    return {
      query,
      found: found.length > 0,
      players: found.map((p) => {
        const r = records.find((x) => x.id === p.id);
        return { id: p.id, matchName: p.match_name, competition: p.competition, authoredOvr: p.authoredOvr, record: r ? slim(r) : null, status: !r ? "unmatched" : (r.reason ?? "estimated"), inAsset: entryIds.has(p.id) };
      }),
    };
  });
  return {
    method: METHOD,
    window,
    referenceDate,
    levels: Object.fromEntries(Object.entries(levels).map(([id, l]) => [id, { ...l, ...counts[id] }])),
    totals: {
      gamePlayers: players.length,
      rostered: players.filter((p) => p.team_id).length,
      matched: identity.matches.length,
      matchedBy: Object.fromEntries(["team", "role-competition", "pin"].map((via) => [via, identity.matches.filter((m) => m.via === via).length])),
      estimated: estimated.length,
      entries: entries.length,
      competitionMismatch: estimated.filter((r) => r.competitionMismatch).length,
      review: identity.review.length,
      unmatchedLinks: identity.unmatched.length,
      noEstimate,
      estimateReasons: Object.fromEntries(
        Object.entries(estimates.reduce((acc, e) => ({ ...acc, [e.reason ?? "ok"]: (acc[e.reason ?? "ok"] ?? 0) + 1 }), {})).sort(([a], [b]) => compare(a, b)),
      ),
    },
    competitions,
    thresholds,
    risers: byDelta.slice(0, 25).map(slim),
    fallers: [...byDelta].reverse().slice(0, 25).map(slim),
    suspects,
    review: identity.review,
    unmatched: identity.unmatched.slice(0, 50),
    pinIssues: identity.pinIssues,
    mismatches: estimated.filter((r) => r.competitionMismatch).map((r) => ({ ...slim(r), gameCompetition: r.gameCompetition, statLevel: r.statLevel, gameLevel: r.gameLevel, levelUsed: r.levelUsed, target: r.target })),
    spotlight,
  };
}

const row = (cells) => `| ${cells.join(" | ")} |`;
const table = (headers, rows) => [row(headers), row(headers.map(() => "---")), ...rows.map(row)].join("\n");

/** Markdown version of the report (the JSON has the same data). */
export function renderReport(report) {
  const t = report.totals;
  const player = (p) => [p.matchName, p.competition ?? "-", p.statCompetition ?? "-", p.role ?? "-", p.games, p.authoredOvr, p.newOvr, p.delta > 0 ? `+${p.delta}` : p.delta, p.confidence, p.suspect ? "yes" : ""];
  const playerHeaders = ["player", "competition", "stat competition", "role", "games", "before", "after", "delta", "w", "suspect"];
  const lines = [
    "# Stat-based ratings: before and after",
    "",
    `Method \`${report.method}\`, window ${report.window.since} to ${report.window.until}, reference date ${report.referenceDate}.`,
    "Data: Leaguepedia (lol.fandom.com), CC BY-SA 3.0. League levels are the fixed authored ladder.",
    "",
    "## Totals",
    "",
    `- Game players ${t.gamePlayers} (${t.rostered} rostered); matched ${t.matched} (team ${t.matchedBy.team}, role+competition ${t.matchedBy["role-competition"]}, pins ${t.matchedBy.pin}); estimated ${t.estimated}; asset entries ${t.entries}.`,
    `- Stat competition differs from the game competition: ${t.competitionMismatch}. Review list: ${t.review}. Unmatched Leaguepedia links: ${t.unmatchedLinks}.`,
    `- Matched without an estimate: ${Object.entries(t.noEstimate).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`,
    "",
    "## League levels (fixed ladder)",
    "",
    table(["competition", "median", "sd", "n used", "n excluded"], Object.entries(report.levels).map(([id, l]) => [id, l.median, l.sd, l.n_used, l.n_excluded])),
    "",
    "## Per competition",
    "",
    table(
      ["competition", "players", "matched", "estimated", "entries", "mean abs delta", "max abs delta"],
      report.competitions.map((c) => [c.competition, c.players, c.matched, c.estimated, c.entries, c.meanAbsDelta, c.maxAbsDelta]),
    ),
    "",
    "## Threshold crossings (OVR)",
    "",
    table(["OVR", "crossing up", "crossing down"], report.thresholds.map((x) => [x.ovr, x.up, x.down])),
    "",
    "## Spotlight",
    "",
    ...report.spotlight.flatMap((s) =>
      s.found
        ? [`### ${s.query}`, "", table(["id", "competition", "before", "status", "after", "delta", "w", "in asset"], s.players.map((p) => [p.id, p.competition ?? "-", p.authoredOvr, p.status, p.record?.newOvr ?? "-", p.record?.delta ?? "-", p.record?.confidence ?? "-", p.inAsset ? "yes" : "no"])), ""]
        : [`### ${s.query}`, "", "No game player with that name.", ""],
    ),
    "## Top 25 risers",
    "",
    table(playerHeaders, report.risers.map(player)),
    "",
    "## Top 25 fallers",
    "",
    table(playerHeaders, report.fallers.map(player)),
    "",
    `## Suspect authored rows (${report.suspects.length})`,
    "",
    table(["player", "competition", "before", "status", "after", "w"], report.suspects.map((s) => [s.matchName, s.competition ?? "-", s.authoredOvr, s.status, s.newOvr ?? "-", s.confidence ?? "-"])),
    "",
    `## Review list (${report.review.length})`,
    "",
    table(["link", "reason", "candidates"], report.review.map((r) => [r.link, r.reason, r.candidates.map((c) => `${c.matchName} (${c.id}, ${c.competition ?? "fa"}, ${c.position})`).join("; ")])),
    "",
    "## Unmatched Leaguepedia links with the most games",
    "",
    table(["link", "games", "latest team", "competition"], report.unmatched.map((u) => [u.link, u.games, u.team ?? "-", u.competition ?? "-"])),
    "",
    ...(report.pinIssues.length ? ["## Pin issues", "", ...report.pinIssues.map((i) => `- ${i}`), ""] : []),
    "## Stat competition differs from game competition",
    "",
    table(
      ["player", "game competition", "stat competition", "game level", "stat level", "level used", "target", "before", "after", "delta"],
      report.mismatches.map((m) => [m.matchName, m.gameCompetition ?? "-", m.statCompetition, m.gameLevel ?? "-", m.statLevel, m.levelUsed, m.target, m.authoredOvr, m.newOvr, m.delta > 0 ? `+${m.delta}` : m.delta]),
    ),
    "",
  ];
  return lines.join("\n");
}

const HELP = `Usage: node scripts/stats/build-overrides.mjs [flags]

  --rows <file>          rows from pro-stats (default src-tauri/target/olm-scratch/stat-ratings/rows.json)
  --players <file>       Leaguepedia index (default: <rows>.players.json)
  --data <dir>           game data (default ./data)
  --overlay <file>       roster overlay (default assets/world/roster-overlay.json)
  --team-map <file>      scripts/world/team-map.json
  --pins <file>          scripts/stats/pins.json
  --out <file>           asset (default assets/world/player-rating-overrides.json)
  --report-dir <dir>     report.md and report.json (default src-tauri/target/olm-scratch/stat-ratings)
  --include-placeholders also write entries for flat-50 and all-zero rows
  -h, --help
`;

export function parseArgs(argv) {
  const args = {
    rows: path.join(scratch, "rows.json"),
    players: null,
    data: DEFAULT_DATA_DIR,
    overlay: DEFAULT_OVERLAY_FILE,
    teamMap: path.join(root, "scripts/world/team-map.json"),
    pins: path.join(here, "pins.json"),
    out: path.join(root, "assets/world/player-rating-overrides.json"),
    reportDir: scratch,
    includePlaceholders: false,
    help: false,
  };
  const value = (i, flag) => {
    if (i >= argv.length || argv[i].startsWith("--")) throw new Error(`${flag} needs a value`);
    return path.resolve(argv[i]);
  };
  const flags = { "--rows": "rows", "--players": "players", "--data": "data", "--overlay": "overlay", "--team-map": "teamMap", "--pins": "pins", "--out": "out", "--report-dir": "reportDir" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--include-placeholders") args.includePlaceholders = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flags[flag]) args[flags[flag]] = value(++i, flag);
    else throw new Error(`unknown flag ${flag}`);
  }
  args.players ??= args.rows.replace(/(\.json)?$/, ".players.json");
  return args;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeText = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** Reads the inputs, builds, and writes the asset, report.json and report.md. */
export function runBuild(args, log = () => {}) {
  const rowsFile = readJson(args.rows);
  const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!isDay(rowsFile.since) || !isDay(rowsFile.until)) {
    throw new Error(`rows file ${args.rows} needs since and until as YYYY-MM-DD strings (got ${JSON.stringify(rowsFile.since)} and ${JSON.stringify(rowsFile.until)})`);
  }
  const indexFile = readJson(args.players);
  const { players, report: worldReport } = loadGamePlayers({ dataDir: args.data, overlayFile: args.overlay });
  log(`game players: ${players.length} (overlay moved ${worldReport.overlay.moved}, retired ${worldReport.overlay.retired}, added ${worldReport.overlay.added})`);
  const pins = fs.existsSync(args.pins) ? readJson(args.pins) : {};
  const { asset, report } = buildOverrides({
    rows: rowsFile.rows,
    window: { since: rowsFile.since, until: rowsFile.until },
    index: indexFile.players,
    players,
    teamMap: readJson(args.teamMap),
    pins,
    includePlaceholders: args.includePlaceholders,
  });
  report.world = worldReport;
  writeText(args.out, `${JSON.stringify(asset, null, 2)}\n`);
  writeText(path.join(args.reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeText(path.join(args.reportDir, "report.md"), renderReport(report));
  log(`matched ${report.totals.matched}, estimated ${report.totals.estimated}, entries ${asset.entries.length} -> ${args.out}`);
  return { asset, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log(HELP);
    else runBuild(args, (message) => console.error(`[stats:build] ${message}`));
  } catch (error) {
    console.error(`[stats:build] ${error.message}`);
    process.exitCode = 1;
  }
}
