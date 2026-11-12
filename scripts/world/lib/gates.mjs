// Plausibility gates run over a candidate overlay before it is written. A failed gate fails the run
// (non-zero exit) unless --allow-gate-failures is passed.
import fs from "node:fs";
import { OFFLINE_LICENSE } from "./overlay.mjs";
import { validateOverlay } from "./overlay-schema.mjs";
import { isRelease, rosterFloor, simulateRosterCounts, startingCounts } from "./roster-floor.mjs";
import { toOverlayWorld } from "./world.mjs";

export { simulateRosterCounts };

export const DEFAULT_GATE_OPTIONS = Object.freeze({
  minRosterSize: 5,
  maxChangedShare: 0.6,
  maxAddsPerTeam: 8,
});

export const EMPTY_GATE_EXCEPTIONS = Object.freeze({ maxChangedShare: {} });

/**
 * Reviewed exceptions: {"maxChangedShare": {"<competitionId>": {"reason": "...", "reviewed": "YYYY-MM-DD"}}}.
 * A missing file means no exceptions; a malformed entry is rejected with a clear error.
 */
export function loadGateExceptions(file) {
  if (!file || !fs.existsSync(file)) return EMPTY_GATE_EXCEPTIONS;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`gate exceptions ${file}: not valid JSON (${error.message})`);
  }
  const fail = (message) => {
    throw new Error(`gate exceptions ${file}: ${message}`);
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("expected an object");
  const section = raw.maxChangedShare ?? {};
  if (section === null || typeof section !== "object" || Array.isArray(section)) fail("maxChangedShare must be an object keyed by competition id");
  for (const [comp, entry] of Object.entries(section)) {
    if (entry === null || typeof entry !== "object") fail(`maxChangedShare.${comp} must be an object with reason and reviewed`);
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") fail(`maxChangedShare.${comp} needs a non-empty reason`);
    if (typeof entry.reviewed !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewed)) fail(`maxChangedShare.${comp} needs a reviewed date (YYYY-MM-DD)`);
  }
  return { maxChangedShare: section };
}

const gate = (name, scope, ok, detail, value = null) => ({ name, scope, ok, detail, value });

function idOf(op) {
  return op.op === "add" ? (op.player ?? op.staff)?.id : op.id;
}

function duplicateIds(ops) {
  const seen = new Set();
  const duplicates = new Set();
  for (const op of ops) {
    const id = idOf(op);
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/**
 * @param {{overlay: object, world: ReturnType<import("./world.mjs").loadWorld>, coveredTeamIds: Set<string>, options?: Partial<typeof DEFAULT_GATE_OPTIONS>, gateExceptions?: GateExceptions}} input
 */
export function runGates({ overlay, world, coveredTeamIds, options = {}, gateExceptions = EMPTY_GATE_EXCEPTIONS }) {
  const config = { ...DEFAULT_GATE_OPTIONS, ...options };
  const results = [];
  const playerOps = overlay.players ?? [];
  const staffOps = overlay.staff ?? [];

  const schema = validateOverlay(overlay, toOverlayWorld(world));
  results.push(
    gate("overlay-valid", "global", schema.ok, schema.ok ? "schema, references and added records validate" : `${schema.errors.length} validation error(s): ${schema.errors.slice(0, 3).map((e) => `${e.path} ${e.code}`).join("; ")}`),
  );

  const placeholder = overlay.source?.license === OFFLINE_LICENSE.text;
  results.push(gate("license-available", "global", !placeholder, placeholder ? "the licence is the offline placeholder (siteinfo was unavailable); re-run with network access so the overlay can credit its source" : "the overlay carries the licence reported by the wiki"));

  const dupes = [...duplicateIds(playerOps), ...duplicateIds(staffOps)];
  results.push(gate("no-id-twice", "global", dupes.length === 0, dupes.length ? `ids in several ops: ${dupes.join(", ")}` : "every id appears in at most one op"));

  // Per team: a team under its floor (min(minRosterSize, starting size)) fails only when a release out of it is
  // still in the overlay. Teams short only through confirmed moves/retirements are listed but pass: the game
  // fills them from free agents at new game.
  const before = startingCounts(world);
  const after = simulateRosterCounts(world, playerOps);
  const playerTeam = new Map(world.players.map((p) => [p.id, p.team_id]));
  const releasedFrom = new Set(playerOps.filter(isRelease).map((op) => playerTeam.get(op.id)).filter(Boolean));
  const shrunk = [];
  const confirmedShort = [];
  for (const teamId of [...coveredTeamIds].sort()) {
    const was = before.get(teamId) ?? 0;
    const now = after.get(teamId) ?? 0;
    if (now >= rosterFloor(was, config.minRosterSize)) continue;
    (releasedFrom.has(teamId) ? shrunk : confirmedShort).push(`${teamId} ${was}->${now}`);
  }
  const shortNote = confirmedShort.length ? `; short only through confirmed moves/retirements; the game fills them from free agents at new game: ${confirmedShort.join(", ")}` : "";
  results.push(gate("min-roster", "team", shrunk.length === 0, shrunk.length ? `teams under their floor (min(${config.minRosterSize}, starting size)) with a release still in the overlay: ${shrunk.join(", ")}${shortNote}` : `no covered team ends under its floor (min(${config.minRosterSize}, starting size)) because of a release${shortNote}`, { shrunk, confirmedShort }));

  const overfull = [];
  const addsPerTeam = new Map();
  // Teamless adds (the active-pros pool's free agents) belong to no team, so they never count against one.
  for (const op of playerOps) if (op.op === "add" && op.player.team_id) addsPerTeam.set(op.player.team_id, (addsPerTeam.get(op.player.team_id) ?? 0) + 1);
  for (const [teamId, count] of addsPerTeam) if (count > config.maxAddsPerTeam) overfull.push(`${teamId} +${count}`);
  results.push(gate("max-adds-per-team", "team", overfull.length === 0, overfull.length ? `too many new players: ${overfull.join(", ")}` : `no team gains more than ${config.maxAddsPerTeam} new players`));

  // Per competition: share of existing players that move or retire.
  const byCompetition = new Map();
  for (const p of world.players) if (p.competition) byCompetition.set(p.competition, { total: 0, changed: 0 });
  for (const p of world.players) if (p.competition) byCompetition.get(p.competition).total += 1;
  const playerById = new Map(world.players.map((p) => [p.id, p]));
  for (const op of playerOps) {
    if (op.op === "add") continue;
    const comp = playerById.get(op.id)?.competition;
    if (comp) byCompetition.get(comp).changed += 1;
  }
  const hot = [];
  const excepted = [];
  for (const [comp, { total, changed }] of byCompetition) {
    if (!(total > 0 && changed / total > config.maxChangedShare)) continue;
    const exception = gateExceptions.maxChangedShare?.[comp];
    if (exception) excepted.push(`${comp} ${changed}/${total} (reviewed exception: ${exception.reason}; reviewed ${exception.reviewed})`);
    else hot.push(`${comp} ${changed}/${total}`);
  }
  const pct = Math.round(config.maxChangedShare * 100);
  const exceptedNote = excepted.length ? `; over ${pct}% but accepted: ${excepted.join("; ")}` : "";
  results.push(gate("max-changed-share", "competition", hot.length === 0, hot.length ? `more than ${pct}% of players changed: ${hot.join(", ")}${exceptedNote}` : `no competition changes more than ${pct}% of its players without a reviewed exception${exceptedNote}`));

  return { ok: results.every((r) => r.ok), results };
}
