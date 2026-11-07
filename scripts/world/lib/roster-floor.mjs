// Roster floor: the overlay may never hollow out a team. The game starts weeks after the data is read, and an
// off-season Leaguepedia page often lists nobody yet, so "not listed any more" must not empty a roster.
export const KEPT_FOR_ROSTER_FLOOR = "kept-for-roster-floor";

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

/** A release is a player `move` to no team. */
export const isRelease = (op) => op.op === "move" && op.team_id === null;

/** Starting player count per team in the bundled world. */
export function startingCounts(world) {
  const counts = new Map();
  for (const p of world.players) if (p.team_id) counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1);
  return counts;
}

/** floor(team) = min(minRosterSize, the team's starting player count). */
export function rosterFloor(startingCount, minRosterSize) {
  return Math.min(minRosterSize, startingCount);
}

/**
 * Drop every release out of each team that would otherwise end under its floor. Moves to other teams, retirements
 * and additions are never dropped. Pure and deterministic: the result depends only on the inputs.
 * @param {{world: object, players: Array<{op: object, id: string, teamId: string|null}>, minRosterSize: number}} input
 * @returns {{players: object[], skipped: Array<{kind: string, subject: string, detail: string}>}}
 */
export function applyRosterFloor({ world, players, minRosterSize }) {
  const start = startingCounts(world);
  const after = simulateRosterCounts(world, players.map((entry) => entry.op));
  const playerById = new Map(world.players.map((p) => [p.id, p]));
  const short = new Map();
  for (const [teamId, was] of [...start].sort(([a], [b]) => a.localeCompare(b))) {
    const floor = rosterFloor(was, minRosterSize);
    const now = after.get(teamId) ?? 0;
    if (now < floor) short.set(teamId, { now, floor });
  }

  const kept = [];
  const skipped = [];
  for (const entry of players) {
    const from = isRelease(entry.op) ? playerById.get(entry.id)?.team_id : null;
    const shortage = from ? short.get(from) : undefined;
    if (!shortage) {
      kept.push(entry);
      continue;
    }
    skipped.push({
      kind: KEPT_FOR_ROSTER_FLOOR,
      subject: `${playerById.get(entry.id).match_name} (${entry.id})`,
      detail: `release dropped: ${from} would end with ${shortage.now} players, under its floor of ${shortage.floor}; ${entry.note}`,
    });
  }
  return { players: kept, skipped };
}
