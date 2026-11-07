// Pure analysis step: compares Leaguepedia rosters with the game world and decides which
// people are matched, new, moved or missing. No I/O; network lookups happen in the pipeline.
import { buildIndex, matchPerson, playerEntity, staffEntity } from "./match.mjs";
import { dataRoleForLabel, resolveRoleChange } from "./staff-policy.mjs";
import { compactKey } from "./text.mjs";

const AUTHORITATIVE_KINDS = new Set(["starter", "sub"]);

const issue = (kind, subject, detail, extra = {}) => ({ kind, subject, detail, ...extra });

/**
 * @param {object} input
 * @param {ReturnType<import("./world.mjs").loadWorld>} input.world
 * @param {Map<string, string>} input.titleToTeam Leaguepedia page title -> game team id (covered teams only)
 * @param {Map<string, {players: object[], staff: object[]}>} input.rosters readable rosters by page title
 * @param {import("./match.mjs").IdMap} input.overrides
 */
export function analyzeRosters({ world, titleToTeam, rosters, overrides }) {
  const playerIndex = buildIndex(world.players.map(playerEntity));
  const staffIndex = buildIndex(world.staff.map(staffEntity));
  const issues = [];
  const teamStats = new Map();

  const playerSightings = new Map(); // game player id -> [{teamId, title, lp}]
  const seenPlayers = new Set();
  const addCandidates = new Map(); // lp page -> [{teamId, title, lp}]
  const staffSightings = new Map();
  const staffAddCandidates = new Map(); // key -> [{teamId,title,lp,role}]
  const seenStaff = new Set();
  const suspectTeams = new Set();

  const stat = (teamId) => {
    if (!teamStats.has(teamId)) teamStats.set(teamId, { lpPlayers: 0, matched: 0, added: 0, ambiguous: 0, refused: 0 });
    return teamStats.get(teamId);
  };
  const gameCount = (teamId) => world.players.filter((p) => p.team_id === teamId).length;

  for (const [title, teamId] of [...titleToTeam].sort()) {
    const roster = rosters.get(title);
    if (!roster) continue;
    const local = { sightings: [], adds: [], issues: [], matched: 0 };
    for (const lp of roster.players) {
      const authoritative = AUTHORITATIVE_KINDS.has(lp.kind);
      const result = matchPerson(lp, playerIndex, { kind: "player", overrides });
      const s = stat(teamId);
      if (authoritative) s.lpPlayers += 1;
      if (result.status === "matched") {
        local.matched += 1;
        s.matched += authoritative ? 1 : 0;
        local.sightings.push({ id: result.entity.id, authoritative, entry: { teamId, title, lp, confidence: result.confidence } });
      } else if (result.status === "ambiguous" || result.status === "refused") {
        s[result.status === "ambiguous" ? "ambiguous" : "refused"] += 1;
        for (const c of result.candidates ?? []) seenPlayers.add(c.id);
        local.issues.push(issue(result.status, `${lp.ign} (${lp.page})`, result.reason, { team: title, candidates: (result.candidates ?? []).map((c) => c.id) }));
      } else if (authoritative) {
        local.adds.push({ teamId, title, lp });
      } else {
        local.issues.push(issue("skipped", `${lp.ign} (${lp.page})`, `unmatched ${lp.roleLabel} entry is not authoritative`, { team: title }));
      }
    }
    if (gameCount(teamId) >= 3 && roster.players.filter((p) => AUTHORITATIVE_KINDS.has(p.kind)).length >= 3 && local.matched === 0) {
      suspectTeams.add(teamId);
      issues.push(issue("suspect-mapping", title, `none of ${roster.players.length} roster entries match a game player; mapping to ${teamId} skipped`));
      continue;
    }
    issues.push(...local.issues);
    for (const sighting of local.sightings) {
      seenPlayers.add(sighting.id);
      if (!sighting.authoritative) continue;
      if (!playerSightings.has(sighting.id)) playerSightings.set(sighting.id, []);
      playerSightings.get(sighting.id).push(sighting.entry);
    }
    for (const add of local.adds) {
      const list = addCandidates.get(add.lp.page) ?? [];
      list.push(add);
      addCandidates.set(add.lp.page, list);
    }

    for (const lp of roster.staff) {
      const role = dataRoleForLabel(lp.roleLabel);
      if (!role || lp.inactive) continue;
      const result = matchPerson({ ...lp, page: lp.page ?? lp.ign }, staffIndex, { kind: "staff", overrides });
      if (result.status === "matched") {
        seenStaff.add(result.entity.id);
        const list = staffSightings.get(result.entity.id) ?? [];
        list.push({ teamId, title, lp, role });
        staffSightings.set(result.entity.id, list);
      } else if (result.status === "none") {
        const key = `${compactKey(lp.ign)}|${compactKey(lp.realName)}`;
        const list = staffAddCandidates.get(key) ?? [];
        list.push({ teamId, title, lp, role });
        staffAddCandidates.set(key, list);
      } else {
        issues.push(issue(`staff-${result.status}`, `${lp.ign || lp.realName} (${lp.roleLabel})`, result.reason, { team: title }));
      }
    }
  }

  // --- players: moves, add candidates ------------------------------------------------------------------
  const moves = [];
  for (const [id, sightings] of [...playerSightings].sort(([a], [b]) => a.localeCompare(b))) {
    const entity = playerIndex.byId.get(id);
    const targets = [...new Set(sightings.map((s) => s.teamId))];
    if (targets.includes(entity.ref.team_id)) continue; // already where Leaguepedia lists him
    if (targets.length > 1) {
      issues.push(issue("conflict", `${entity.ign} (${id})`, `listed on several teams: ${sightings.map((s) => s.title).join(", ")}`));
      continue;
    }
    moves.push({ id, entity, sighting: sightings[0] });
  }

  const adds = [];
  for (const [page, list] of [...addCandidates].sort(([a], [b]) => a.localeCompare(b))) {
    const teams = [...new Set(list.map((c) => c.teamId))];
    if (teams.length > 1) {
      issues.push(issue("conflict", page, `new player listed on several teams: ${list.map((c) => c.title).join(", ")}`));
      continue;
    }
    if (list[0].lp.position === null) {
      issues.push(issue("skipped", page, `cannot derive a position from role "${list[0].lp.roleLabel}"`, { team: list[0].title }));
      continue;
    }
    adds.push(list[0]);
  }

  // --- players that vanished from their own (readable) team -------------------------------------------------
  const readableTeamIds = new Set([...titleToTeam].filter(([title, id]) => rosters.has(title) && !suspectTeams.has(id)).map(([, id]) => id));
  const absent = world.players.filter((p) => p.team_id && readableTeamIds.has(p.team_id) && !seenPlayers.has(p.id));

  // --- staff -----------------------------------------------------------------------------------------------
  const staffMoves = [];
  for (const [id, sightings] of [...staffSightings].sort(([a], [b]) => a.localeCompare(b))) {
    const entity = staffIndex.byId.get(id);
    if (entity.ref.role === "Owner") continue;
    const targets = [...new Set(sightings.map((s) => s.teamId))];
    const teamChanged = !targets.includes(entity.ref.team_id);
    if (teamChanged && targets.length > 1) {
      issues.push(issue("conflict", `${entity.ign || entity.name} (${id})`, `staff listed on several teams: ${sightings.map((s) => s.title).join(", ")}`));
      continue;
    }
    const sighting = teamChanged ? sightings[0] : sightings.find((s) => s.teamId === entity.ref.team_id);
    const change = resolveRoleChange(entity.ref.role, sighting.role);
    if (change.blockedBy) issues.push(issue("role-policy", `${entity.ign || entity.name} (${id})`, `${sighting.lp.roleLabel} on ${sighting.title}: ${change.blockedBy}`, { level: "info" }));
    if (teamChanged || change.role) staffMoves.push({ id, entity, sighting, role: change.role, teamChanged });
  }
  const staffAdds = [];
  for (const [key, list] of [...staffAddCandidates].sort(([a], [b]) => a.localeCompare(b))) {
    const teams = [...new Set(list.map((c) => c.teamId))];
    if (teams.length > 1) {
      issues.push(issue("conflict", list[0].lp.ign || list[0].lp.realName, `new staff listed on several teams: ${list.map((c) => c.title).join(", ")}`));
      continue;
    }
    staffAdds.push(list[0]);
  }

  return { moves, adds, absent, staffMoves, staffAdds, issues, teamStats, suspectTeams, seenPlayers, seenStaff };
}
