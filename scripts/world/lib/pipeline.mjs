// Orchestrates one refresh: read rosters, match, decide, generate, gate, serialise.
import fs from "node:fs";
import {
  OfflineCacheMissError,
  RequestBudgetExceededError,
  fetchRights,
  fetchSectionHtml,
  fetchSections,
} from "./mediawiki-client.mjs";
import { findTeamSections, parseActiveRoster, parseStaffTable } from "./leaguepedia-parse.mjs";
import { analyzeRosters } from "./analyze.mjs";
import { computeBaselines } from "./generate.mjs";
import { DEFAULT_GATE_OPTIONS, runGates } from "./gates.mjs";
import { applyRosterFloor } from "./roster-floor.mjs";
import { lookupInfobox, lookupPlayerStatus } from "./player-status.mjs";
import { buildOps } from "./ops.mjs";
import { OFFLINE_LICENSE, buildOverlay, todayUtc } from "./overlay.mjs";
import { renderReport } from "./report.mjs";
import { EMPTY_ID_MAP } from "./match.mjs";
import { loadTeamMap } from "./team-map.mjs";
import { coveredCompetitionIds, loadWorld } from "./world.mjs";

/** Errors that mean "stop the run" rather than "skip this item". */
const isFatal = (error) => error instanceof RequestBudgetExceededError;

export function loadIdMap(file) {
  if (!file || !fs.existsSync(file)) return EMPTY_ID_MAP;
  return { ...EMPTY_ID_MAP, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

export async function fetchTeamRoster(client, title) {
  const sections = await fetchSections(client, title);
  const { active, staff } = findTeamSections(sections);
  if (!active) return { error: "no Active roster section" };
  const players = parseActiveRoster(await fetchSectionHtml(client, title, active));
  const staffRows = staff ? parseStaffTable(await fetchSectionHtml(client, title, staff)) : [];
  return { players, staff: staffRows };
}

/**
 * @param {object} options
 * @param {string} options.dataDir
 * @param {string} options.teamMapPath
 * @param {string} [options.idMapPath]
 * @param {string[]} [options.competitions] defaults to every covered competition
 * @param {import("./mediawiki-client.mjs").MediaWikiClient} options.client
 * @param {string} [options.asOf] defaults to the fetch date of the oldest cache entry used
 * @param {object} [options.gateOptions]
 * @param {import("./gates.mjs").GateExceptions} [options.gateExceptions] reviewed max-changed-share exceptions
 * @param {(message: string) => void} [options.log]
 */
export async function runRefresh(options) {
  const log = options.log ?? (() => {});
  const warnings = [];
  const world = loadWorld(options.dataDir);
  const covered = coveredCompetitionIds(world);
  const selected = options.competitions?.length ? [...options.competitions].sort() : covered;
  const unknown = selected.filter((id) => !covered.includes(id));
  if (unknown.length) throw new Error(`not a covered competition: ${unknown.join(", ")} (covered: ${covered.join(", ")})`);

  const teamMap = loadTeamMap(options.teamMapPath);
  const overrides = loadIdMap(options.idMapPath);
  const selectedTeams = world.competitions.filter((c) => selected.includes(c.id)).flatMap((c) => c.teamIds);

  // --- team mapping ------------------------------------------------------------------------------------
  const unmapped = [];
  const titleToTeam = new Map();
  for (const teamId of selectedTeams) {
    const entry = teamMap.teams[teamId];
    const team = world.teams.get(teamId);
    if (!entry?.title) unmapped.push({ id: teamId, name: team.name, reason: entry?.reason ?? "not in team-map.json" });
    else if (titleToTeam.has(entry.title)) unmapped.push({ id: teamId, name: team.name, reason: `page "${entry.title}" already mapped to ${titleToTeam.get(entry.title)}` });
    else titleToTeam.set(entry.title, teamId);
  }

  // --- rosters -----------------------------------------------------------------------------------------
  const rosters = new Map();
  const unreadable = [];
  for (const title of [...titleToTeam.keys()].sort()) {
    try {
      const roster = await fetchTeamRoster(options.client, title);
      if (roster.error) unreadable.push({ title, reason: roster.error });
      else rosters.set(title, roster);
      log(`roster ${title}: ${roster.error ?? `${roster.players.length} players, ${roster.staff.length} staff rows`}`);
    } catch (error) {
      if (isFatal(error)) throw error;
      unreadable.push({ title, reason: error instanceof OfflineCacheMissError ? "not in the offline cache" : error.message });
    }
  }

  // --- analysis ----------------------------------------------------------------------------------------
  const analysis = analyzeRosters({ world, titleToTeam, rosters, overrides });
  log(`matched: ${analysis.moves.length} moves, ${analysis.adds.length} new players, ${analysis.absent.length} missing players`);

  const statuses = new Map();
  for (const player of analysis.absent) {
    try {
      statuses.set(player.id, await lookupPlayerStatus(options.client, player));
    } catch (error) {
      if (isFatal(error)) throw error;
      warnings.push(`status of ${player.match_name} (${player.id}) unavailable: ${error.message}`);
    }
  }
  const infoboxes = new Map();
  for (const { lp } of analysis.adds) {
    try {
      infoboxes.set(lp.page, await lookupInfobox(options.client, lp.page));
    } catch (error) {
      if (isFatal(error)) throw error;
      warnings.push(`infobox of ${lp.page} unavailable (birth date will be approximate): ${error.message}`);
    }
  }

  // --- operations, overlay, gates ------------------------------------------------------------------------
  const baselines = computeBaselines(world);
  const built = buildOps({ world, analysis, statuses, infoboxes, baselines });
  const minRosterSize = options.gateOptions?.minRosterSize ?? DEFAULT_GATE_OPTIONS.minRosterSize;
  const floored = applyRosterFloor({ world, players: built.players, minRosterSize });
  const ops = { ...built, players: floored.players, skipped: [...built.skipped, ...floored.skipped] };

  let license = OFFLINE_LICENSE;
  try {
    const rights = await fetchRights(options.client);
    if (rights.text) license = rights;
  } catch (error) {
    if (isFatal(error)) throw error;
    warnings.push(`license lookup failed (${error.message}); overlay carries a placeholder license`);
  }

  const readableTeamIds = new Set([...rosters.keys()].map((title) => titleToTeam.get(title)).filter((id) => !analysis.suspectTeams.has(id)));
  const coverage = world.competitions.filter((c) => selected.includes(c.id) && c.teamIds.some((id) => readableTeamIds.has(id))).map((c) => c.id);
  // The overlay is only as fresh as the stalest answer it was built from.
  const oldestFetch = options.client.oldestFetchDate?.() ?? null;
  if (options.asOf && oldestFetch && options.asOf > oldestFetch) {
    warnings.push(`--as-of ${options.asOf} is newer than the oldest cache entry used (fetched ${oldestFetch}); the rosters may be older than the overlay date claims`);
  }
  const asOf = options.asOf ?? oldestFetch ?? todayUtc();
  const overlay = buildOverlay({ asOf, license, coverage, players: ops.players, staff: ops.staff });
  const gates = runGates({ overlay, world, coveredTeamIds: readableTeamIds, options: options.gateOptions, gateExceptions: options.gateExceptions });

  const teamRows = selectedTeams.map((teamId) => {
    const team = world.teams.get(teamId);
    const title = teamMap.teams[teamId]?.title ?? null;
    const stats = analysis.teamStats.get(teamId) ?? { lpPlayers: 0, matched: 0, added: 0, ambiguous: 0, refused: 0, review: 0 };
    const added = analysis.adds.filter((a) => a.teamId === teamId).length;
    let state = "ok";
    if (!title || unmapped.some((u) => u.id === teamId)) state = "unmapped";
    else if (analysis.suspectTeams.has(teamId)) state = "suspect mapping";
    else if (!rosters.has(title)) state = "unreadable";
    return { competition: team.competition, name: team.name, title, ...stats, added, state };
  });

  const report = renderReport({
    asOf: overlay.as_of, license, selected, world, teamRows, unmapped, unreadable, ops, gates,
    issues: analysis.issues, clientStats: options.client.stats, warnings,
  });

  return { overlay, gates, report, world, summary: { players: ops.players.length, staff: ops.staff.length, unmapped: unmapped.length, unreadable: unreadable.length, coverage }, warnings, ops };
}
