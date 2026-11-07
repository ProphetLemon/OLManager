// Plausibility gates run over a candidate overlay before it is written. A failed gate fails the run
// (non-zero exit) unless --allow-gate-failures is passed.
import { validateOverlay } from "./overlay-schema.mjs";
import { toOverlayWorld } from "./world.mjs";

export const DEFAULT_GATE_OPTIONS = Object.freeze({
  minRosterSize: 5,
  maxChangedShare: 0.6,
  maxAddsPerTeam: 8,
});

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

/** Apply player ops to a copy of the roster counts: returns Map(teamId -> player count). */
export function simulateRosterCounts(world, playerOps) {
  const team = new Map(world.players.map((p) => [p.id, p.team_id]));
  for (const op of playerOps) {
    if (op.op === "move") team.set(op.id, op.team_id);
    else if (op.op === "retire") team.set(op.id, null);
    else if (op.op === "add") team.set(op.player.id, op.player.team_id);
  }
  const counts = new Map();
  for (const teamId of team.values()) if (teamId) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  return counts;
}

/**
 * @param {{overlay: object, world: ReturnType<import("./world.mjs").loadWorld>, coveredTeamIds: Set<string>, options?: Partial<typeof DEFAULT_GATE_OPTIONS>}} input
 */
export function runGates({ overlay, world, coveredTeamIds, options = {} }) {
  const config = { ...DEFAULT_GATE_OPTIONS, ...options };
  const results = [];
  const playerOps = overlay.players ?? [];
  const staffOps = overlay.staff ?? [];

  const schema = validateOverlay(overlay, toOverlayWorld(world));
  results.push(
    gate("overlay-valid", "global", schema.ok, schema.ok ? "schema, references and added records validate" : `${schema.errors.length} validation error(s): ${schema.errors.slice(0, 3).map((e) => `${e.path} ${e.code}`).join("; ")}`),
  );

  const dupes = [...duplicateIds(playerOps), ...duplicateIds(staffOps)];
  results.push(gate("no-id-twice", "global", dupes.length === 0, dupes.length ? `ids in several ops: ${dupes.join(", ")}` : "every id appears in at most one op"));

  // Per team: no team may be pushed under the minimum roster by the overlay.
  const before = new Map();
  for (const p of world.players) if (p.team_id) before.set(p.team_id, (before.get(p.team_id) ?? 0) + 1);
  const after = simulateRosterCounts(world, playerOps);
  const shrunk = [];
  for (const teamId of [...coveredTeamIds].sort()) {
    const was = before.get(teamId) ?? 0;
    const now = after.get(teamId) ?? 0;
    if (now < Math.min(config.minRosterSize, was)) shrunk.push(`${teamId} ${was}->${now}`);
  }
  results.push(gate("min-roster", "team", shrunk.length === 0, shrunk.length ? `teams under ${config.minRosterSize} players: ${shrunk.join(", ")}` : `no covered team ends under ${config.minRosterSize} players (or below its starting size)`));

  const overfull = [];
  const addsPerTeam = new Map();
  for (const op of playerOps) if (op.op === "add") addsPerTeam.set(op.player.team_id, (addsPerTeam.get(op.player.team_id) ?? 0) + 1);
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
  for (const [comp, { total, changed }] of byCompetition) {
    if (total > 0 && changed / total > config.maxChangedShare) hot.push(`${comp} ${changed}/${total}`);
  }
  results.push(gate("max-changed-share", "competition", hot.length === 0, hot.length ? `more than ${Math.round(config.maxChangedShare * 100)}% of players changed: ${hot.join(", ")}` : `no competition changes more than ${Math.round(config.maxChangedShare * 100)}% of its players`));

  return { ok: results.every((r) => r.ok), results };
}
