// Gates for the active-pros pool. They run over the candidate overlay (not over the selection that built it), so a bug in
// the selection cannot hide from them. Same shape as lib/gates.mjs: a failed gate fails the run unless --allow-gate-failures.
import { deterministicId } from "./generate.mjs";
import { ADDED_STAFF_ROLES, POSITIONS } from "./overlay-schema.mjs";
import { buildIndex, matchPerson, playerEntity, staffEntity } from "./match.mjs";
import { POOL_LIMITS, compare } from "./pool.mjs";
import { compactKey, countryToIso2 } from "./text.mjs";

const gate = (name, ok, detail, value = null) => ({ name, scope: "pool", ok, detail, value });
const head = (list, count = 5) => `${list.slice(0, count).join(", ")}${list.length > count ? `, ... (${list.length} in all)` : ""}`;

const isPoolAdd = (op) => op.op === "add" && op.pool !== undefined;
const recordOf = (op) => op.player ?? op.staff;
const kindOf = (op) => (op.player ? "player" : "staff");

/**
 * @param {object} input
 * @param {{players?: object[], staff?: object[]}} input.overlay the candidate overlay
 * @param {import("./world.mjs").World} input.world
 * @param {unknown} [input.overrides] reviewed id-map.json
 * @param {Array<{page: string, id: string}>} [input.collisions] id collisions the selection found
 * @param {number} input.bytes size of the serialised overlay
 * @param {Partial<typeof POOL_LIMITS>} [input.limits]
 */
export function runPoolGates({ overlay, world, overrides, collisions = [], bytes, limits = {} }) {
  const max = { ...POOL_LIMITS, ...limits };
  const players = (overlay.players ?? []).filter(isPoolAdd);
  const staff = (overlay.staff ?? []).filter(isPoolAdd);
  const all = [...players, ...staff];
  const results = [];

  // Size: the pool's own totals and the game's hard limit on ops per list (olm_core::world_overlay MAX_OPS).
  const over = [];
  if (players.length > max.players) over.push(`${players.length} pool players (limit ${max.players})`);
  if (staff.length > max.staff) over.push(`${staff.length} pool staff (limit ${max.staff})`);
  if ((overlay.players ?? []).length > max.opsPerList) over.push(`${overlay.players.length} player ops in all (the game rejects more than ${max.opsPerList})`);
  if ((overlay.staff ?? []).length > max.opsPerList) over.push(`${overlay.staff.length} staff ops in all (the game rejects more than ${max.opsPerList})`);
  results.push(gate("pool-size", over.length === 0, over.length ? over.join("; ") : `${players.length} pool players (limit ${max.players}), ${staff.length} pool staff (limit ${max.staff}); ${(overlay.players ?? []).length} player and ${(overlay.staff ?? []).length} staff ops in all (game limit ${max.opsPerList} each)`, { players: players.length, staff: staff.length }));

  // Complete: name and role.
  const incomplete = [];
  for (const op of all) {
    const record = recordOf(op);
    const name = kindOf(op) === "player" ? [record.match_name, record.full_name] : [record.nickname, record.first_name];
    const roleOk = kindOf(op) === "player" ? POSITIONS.includes(record.position) : ADDED_STAFF_ROLES.includes(record.role);
    if (name.some((value) => typeof value !== "string" || value.trim() === "") || !roleOk || !op.pool.role) incomplete.push(op.pool.page ?? record.id);
  }
  results.push(gate("pool-complete", incomplete.length === 0, incomplete.length ? `pool people without a name or a usable role: ${head(incomplete)}` : "every pool person has a name and a game role"));

  // Ids: derived from the page, well formed, unique, and not the id of anybody in the game.
  const gameIds = { player: new Set(world.players.map((p) => p.id)), staff: new Set(world.staff.map((s) => s.id)) };
  const seen = new Map();
  const badIds = [];
  for (const op of all) {
    const record = recordOf(op);
    const kind = kindOf(op);
    const expected = deterministicId(kind, op.pool.page);
    if (record.id !== expected) badIds.push(`${record.id} is not the id of page "${op.pool.page}" (${expected})`);
    if (gameIds[kind].has(record.id)) badIds.push(`${record.id} (${op.pool.page}) is the id of a person already in the game`);
    const key = `${kind}:${record.id}`;
    if (seen.has(key)) badIds.push(`${record.id} used by "${seen.get(key)}" and "${op.pool.page}"`);
    else seen.set(key, op.pool.page);
  }
  for (const c of collisions) badIds.push(`${c.id} (${c.page}) collides with ${c.with}; the person was left out`);
  results.push(gate("pool-ids", badIds.length === 0, badIds.length ? `id problems: ${head(badIds)}` : "ids are derived from the Leaguepedia page, unique and not used by the game", { collisions: collisions.length }));

  // Duplicates: against the game (the matcher the roster refresh uses) and inside the pool.
  const indexes = { player: buildIndex(world.players.map(playerEntity)), staff: buildIndex(world.staff.map(staffEntity)) };
  const dupGame = [];
  const byIdentity = new Map();
  for (const op of all) {
    const record = recordOf(op);
    const kind = kindOf(op);
    const ign = kind === "player" ? record.match_name : record.nickname;
    const fullName = kind === "player" ? record.full_name : record.first_name;
    const realName = compactKey(fullName) === compactKey(ign) ? "" : fullName;
    const birthDate = op.dob_approx ? null : record.date_of_birth;
    const country = record.nationality;
    const match = matchPerson({ ign, page: op.pool.page, realName, country: country || null, birthDate }, indexes[kind], { kind, overrides });
    if (["matched", "review", "ambiguous"].includes(match.status)) dupGame.push(`${op.pool.page} ~ ${match.entity?.id ?? match.candidates?.map((c) => c.id).join("/")} (${match.status})`);
    const identity = [kind, compactKey(ign), compactKey(realName), countryToIso2(country), birthDate ?? ""].join("|");
    byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), op.pool.page]);
  }
  const dupPool = [...byIdentity.values()].filter((pages) => pages.length > 1).map((pages) => [...pages].sort(compare).join(" = "));
  const dupReasons = [];
  if (dupGame.length) dupReasons.push(`already in the game: ${head(dupGame)}`);
  if (dupPool.length) dupReasons.push(`repeated inside the pool: ${head(dupPool)}`);
  results.push(gate("pool-no-duplicates", dupReasons.length === 0, dupReasons.length ? dupReasons.join("; ") : "no pool person matches a game record or another pool person", { game: dupGame.length, pool: dupPool.length }));

  // Size on disk: the app refuses an overlay larger than this (commands::world_overlay MAX_OVERLAY_BYTES).
  results.push(gate("pool-overlay-size", bytes <= max.overlayBytes, `overlay is ${bytes} bytes; the app rejects more than ${max.overlayBytes}`, { bytes }));
  return results;
}
