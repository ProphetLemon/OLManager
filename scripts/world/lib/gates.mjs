// Plausibility gates run over a candidate overlay before it is written. A failed gate fails the run
// (non-zero exit) unless --allow-gate-failures is passed.
import fs from "node:fs";
import { OFFLINE_LICENSE } from "./overlay.mjs";
import { validateOverlay } from "./overlay-schema.mjs";
import { isRelease, rosterFloor, simulateRosterCounts, startingCounts } from "./roster-floor.mjs";
import { foldName, foldedNames, realBirthDate } from "./same-person.mjs";
import { titleKey } from "./pool.mjs";
import { toOverlayWorld } from "./world.mjs";

export { simulateRosterCounts };

/**
 * People Leaguepedia lists in both roles on one team, reviewed: each may be a player and a staff member at once. Anybody
 * else held twice fails `no-player-staff-twins`. src-tauri/src/world_identity_review.json `dual_roles` holds the same pairs.
 */
export const DUAL_ROLES = Object.freeze([
  // CTBC Flying Oyster Academy (PCS), Leaguepedia team page of the 2026-11-17 run: Leaky (Chang Tsu-Chia) is a starting
  // Jungler (joined 2026-07-15) and, in the same page's staff table, the Head Coach (not inactive). A player-coach.
  Object.freeze({ player: "player-6498e762", staff: "staff-6498e762" }),
]);

/** The date the staff generator writes when it has no birth date (generate.mjs `generateStaff`); it says nothing. */
const STAFF_PLACEHOLDER_DOB = "1990-01-01";
const PAGE_HASH_ID = /^(?:player|staff)-([0-9a-f]{8})$/;

/** The records of one kind once the ops are applied: retirements leave, adds arrive with whether their birth date is a guess. */
function recordsAfter(records, ops, kind) {
  const byId = new Map(records.map((record) => [record.id, { record, dobApprox: false }]));
  for (const op of ops) {
    if (op.op === "retire") byId.delete(op.id);
    else if (op.op === "add" && op[kind]) byId.set(op[kind].id, { record: op[kind], dobApprox: op.dob_approx === true });
  }
  return [...byId.values()];
}

const staffNames = (staff) => {
  const names = [staff.nickname, staff.first_name, `${staff.first_name ?? ""} ${staff.last_name ?? ""}`].map(foldName).filter(Boolean);
  return [...new Set(names)];
};

/** A birth date that identifies: readable, not a catalog placeholder, not a guess. */
const knownBirthDate = ({ record, dobApprox }) => {
  if (dobApprox || record.date_of_birth === STAFF_PLACEHOLDER_DOB) return null;
  return realBirthDate(record.date_of_birth)?.iso ?? null;
};

/**
 * The people a new world would hold both as a player and as a staff member, by the keys world_identity.rs uses for that pair
 * (`no_person_is_both_a_player_and_a_staff_member`): the same Leaguepedia page, or a shared folded name and the same real birth
 * date. Ids made from a page ("player-"/"staff-" plus 8 hex of the page hash) with the same hash share the page; `pages` adds the
 * page titles this run knows (by id), which also catches one page spelled two ways. Pairs in `allowed` are left out.
 * @param {{overlay: {players?: object[], staff?: object[]}, world: {players: object[], staff: object[]}, pages?: Map<string, string>, allowed?: ReadonlyArray<{player: string, staff: string}>}} input
 * @returns {Array<{player: string, staff: string, rule: "same-page"|"name-and-birth-date"}>} sorted by player id, then staff id
 */
export function playerStaffTwins({ overlay, world, pages = new Map(), allowed = DUAL_ROLES }) {
  const players = recordsAfter(world.players, overlay.players ?? [], "player");
  const staff = recordsAfter(world.staff, overlay.staff ?? [], "staff");
  const skip = new Set(allowed.map((pair) => `${pair.player}\u0000${pair.staff}`));
  const found = new Map();
  const note = (player, staffId, rule) => {
    const key = `${player}\u0000${staffId}`;
    if (!skip.has(key) && !found.has(key)) found.set(key, { player, staff: staffId, rule });
  };

  const pageOf = (id) => {
    const hash = PAGE_HASH_ID.exec(id)?.[1];
    const title = pages.get(id);
    return [hash ? `hash:${hash}` : null, title ? `title:${titleKey(title)}` : null].filter(Boolean);
  };
  const staffByPage = new Map();
  for (const { record } of staff) for (const key of pageOf(record.id)) staffByPage.set(key, [...(staffByPage.get(key) ?? []), record.id]);
  for (const { record } of players) for (const key of pageOf(record.id)) for (const staffId of staffByPage.get(key) ?? []) note(record.id, staffId, "same-page");

  const staffByNameAndBirth = new Map();
  for (const entry of staff) {
    const born = knownBirthDate(entry);
    if (!born) continue;
    for (const name of staffNames(entry.record)) staffByNameAndBirth.set(`${name}|${born}`, [...(staffByNameAndBirth.get(`${name}|${born}`) ?? []), entry.record.id]);
  }
  for (const entry of players) {
    const born = knownBirthDate(entry);
    if (!born) continue;
    for (const name of foldedNames(entry.record)) for (const staffId of staffByNameAndBirth.get(`${name}|${born}`) ?? []) note(entry.record.id, staffId, "name-and-birth-date");
  }
  return [...found.values()].sort((a, b) => (a.player < b.player ? -1 : a.player > b.player ? 1 : a.staff < b.staff ? -1 : a.staff > b.staff ? 1 : 0));
}

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
 * @param {{overlay: object, world: ReturnType<import("./world.mjs").loadWorld>, coveredTeamIds: Set<string>, options?: Partial<typeof DEFAULT_GATE_OPTIONS>, gateExceptions?: GateExceptions, pages?: Map<string, string>}} input
 *   `pages`: the Leaguepedia page of each added id, when the run knows it (`playerStaffTwins`)
 */
export function runGates({ overlay, world, coveredTeamIds, options = {}, gateExceptions = EMPTY_GATE_EXCEPTIONS, pages = new Map() }) {
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

  // One person, two records: a player and a staff member of the same person (a coach the pool also adds as a free agent).
  const twins = playerStaffTwins({ overlay, world, pages });
  const shown = twins.slice(0, 5).map((t) => `${t.player} ~ ${t.staff} (${t.rule})`).join(", ");
  results.push(gate("no-player-staff-twins", "global", twins.length === 0, twins.length ? `people who are both a player and a staff member: ${shown}${twins.length > 5 ? `, ... (${twins.length} in all)` : ""}` : `nobody is both a player and a staff member (${DUAL_ROLES.length} reviewed dual role(s) allowed)`, { twins: twins.length }));

  return { ok: results.every((r) => r.ok), results };
}
