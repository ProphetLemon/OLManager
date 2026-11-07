// Turns an analysis into contract-v1 operations (plus the human-readable notes the report prints).
import { generatePlayer, generateStaff } from "./generate.mjs";
import { pageUrl } from "./leaguepedia-parse.mjs";
import { compactKey } from "./text.mjs";

const MIN_CONTRACT_YEAR = 2026;

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** True when `name` is (a near-spelling of) a team that exists in the game world. Near matches absorb data typos. */
export function isWorldTeamName(name, worldTeamNames) {
  const key = compactKey(name);
  if (worldTeamNames.has(key)) return true;
  return key.length >= 6 && [...worldTeamNames].some((known) => Math.abs(known.length - key.length) <= 2 && editDistance(known, key) <= 2);
}

function validContractEnd(date) {
  return date && Number(date.slice(0, 4)) >= MIN_CONTRACT_YEAR ? date : undefined;
}

const sortKey = (entry) => [entry.competition ?? "", entry.teamId ?? "", entry.id, entry.op.op].join("\u0000");
const bySortKey = (a, b) => sortKey(a).localeCompare(sortKey(b));

/**
 * Decide what a missing player's page says. Only explicit evidence produces an op.
 * @returns {{op: object, note: string}|{skip: string}}
 */
export function decideAbsentPlayer(player, status, worldTeamNames) {
  if (!status?.found) return { skip: "no matching player page; status unknown" };
  const evidence = pageUrl(status.title);
  if (status.isRetired) return { op: { op: "retire", id: player.id, evidence }, note: `${player.match_name} is marked retired` };
  if (status.state === "previously") {
    return { op: { op: "move", id: player.id, team_id: null, evidence }, note: `${player.match_name} has no current team (${status.teamText})` };
  }
  if (status.state === "currently" && status.teamName) {
    if (isWorldTeamName(status.teamName, worldTeamNames)) return { skip: `listed with "${status.teamName}", a team in the game world that is not covered by this run` };
    return { op: { op: "move", id: player.id, team_id: null, evidence }, note: `${player.match_name} is with "${status.teamName}", outside the game world` };
  }
  return { skip: "page does not state a current team or retirement" };
}

/**
 * @param {object} input
 * @param {ReturnType<import("./analyze.mjs").analyzeRosters>} input.analysis
 * @param {Map<string, object>} input.statuses player status by game player id
 * @param {Map<string, object|null>} input.infoboxes infobox by Leaguepedia page of new players
 * @param {ReturnType<import("./generate.mjs").computeBaselines>} input.baselines
 */
export function buildOps({ world, analysis, statuses, infoboxes, baselines }) {
  const players = [];
  const staff = [];
  const skipped = [];
  const takenPlayerIds = new Set(world.players.map((p) => p.id));
  const takenStaffIds = new Set(world.staff.map((s) => s.id));
  const compOfTeam = (teamId) => world.teams.get(teamId)?.competition ?? null;
  const worldTeamNames = new Set([...world.teams.values()].map((t) => compactKey(t.name)));

  for (const { id, entity, sighting } of analysis.moves) {
    const lp = sighting.lp;
    const op = { op: "move", id, team_id: sighting.teamId, evidence: pageUrl(sighting.title) };
    if (lp.kind === "starter" && lp.position && lp.position !== entity.ref.position) op.position = lp.position;
    const contractEnd = validContractEnd(lp.contractEnd);
    if (contractEnd) op.contract_end = contractEnd;
    players.push({ op, id, teamId: sighting.teamId, competition: compOfTeam(sighting.teamId), note: `${entity.ign} ${entity.ref.team_id ?? "free agent"} -> ${sighting.title} (${sighting.confidence ?? sighting.lp.kind})` });
  }

  for (const player of analysis.absent) {
    const decision = decideAbsentPlayer(player, statuses.get(player.id), worldTeamNames);
    if (decision.skip) {
      skipped.push({ kind: "absent-unknown", subject: `${player.match_name} (${player.id})`, detail: decision.skip });
      continue;
    }
    players.push({ op: decision.op, id: player.id, teamId: player.team_id, competition: compOfTeam(player.team_id), note: decision.note });
  }

  for (const { teamId, title, lp } of analysis.adds) {
    const infobox = infoboxes.get(lp.page) ?? null;
    try {
      const { record, dobApprox, nationalityMissing } = generatePlayer({
        page: lp.page, ign: lp.ign, realName: lp.realName, country: lp.country, position: lp.position, teamId,
        competition: compOfTeam(teamId), infobox, baselines, takenIds: takenPlayerIds,
      });
      takenPlayerIds.add(record.id);
      const op = { op: "add", player: record, evidence: pageUrl(title) };
      if (dobApprox) op.dob_approx = true;
      players.push({ op, id: record.id, teamId, competition: compOfTeam(teamId), note: `${lp.ign} (${lp.realName}) new on ${title} as ${lp.position}${nationalityMissing ? "; nationality unresolved" : ""}` });
    } catch (error) {
      skipped.push({ kind: "add-failed", subject: lp.page, detail: error.message });
    }
  }

  for (const { id, entity, sighting, role, teamChanged } of analysis.staffMoves) {
    const op = { op: "move", id, team_id: teamChanged ? sighting.teamId : entity.ref.team_id, evidence: pageUrl(sighting.title) };
    if (role) op.role = role;
    staff.push({ op, id, teamId: op.team_id, competition: compOfTeam(op.team_id), note: `${entity.ign || entity.name} ${entity.ref.team_id ?? "free agent"} -> ${sighting.title}${role ? ` as ${role}` : ""}` });
  }

  for (const { teamId, title, lp, role } of analysis.staffAdds) {
    const canonicalTitle = lp.page ?? `${lp.ign || lp.realName} (${title})`;
    try {
      const { record, dobApprox } = generateStaff({ canonicalTitle, ign: lp.ign, realName: lp.realName, country: lp.country, role, teamId, baselines, takenIds: takenStaffIds });
      takenStaffIds.add(record.id);
      const op = { op: "add", staff: record, evidence: pageUrl(title) };
      if (dobApprox) op.dob_approx = true;
      staff.push({ op, id: record.id, teamId, competition: compOfTeam(teamId), note: `${lp.ign || lp.realName} new on ${title} as ${role} (${lp.roleLabel})` });
    } catch (error) {
      skipped.push({ kind: "add-failed", subject: canonicalTitle, detail: error.message });
    }
  }

  return { players: players.sort(bySortKey), staff: staff.sort(bySortKey), skipped };
}
