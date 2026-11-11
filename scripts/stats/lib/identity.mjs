// Matches Leaguepedia players (by Link) to game players. Pure: no I/O.
//
// Strong match, applied automatically: the compact IGN of the Link (without its parenthetical) or of any in-game name
// seen for it equals the game player's compact match_name, AND either
//   - the Leaguepedia team of the link's latest games maps (scripts/world/team-map.json) to the player's team, or
//   - the link's main role is the player's role and its latest team plays in the player's competition,
// AND the pairing is unique on both sides (the link has exactly one qualifying player and that player is claimed by
// exactly one link). Everything else with at least one IGN candidate goes to the review list with its reason.
// Links without any IGN candidate are `unmatched`. scripts/stats/pins.json overrides everything:
// { "<Link>": "<player id>" } forces a match, { "<Link>": null } never matches. A player is pinned by at most one link
// (the first in link order wins, the others are reported as pin issues), so asset entry ids stay unique.
import { compactKey, stripParenthetical } from "../../world/lib/text.mjs";

const POSITION_ROLE = Object.freeze({ top: "Top", jungle: "Jungle", mid: "Mid", bot: "Bot", adc: "Bot", support: "Support" });

/** Game position (`ADC` in the data) to the Leaguepedia role used by the stats rows. */
export function roleOfPosition(position) {
  return POSITION_ROLE[String(position ?? "").trim().toLowerCase()] ?? null;
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The team of the latest games: newest `lastDate`, then most games. */
function latestTeam(entry) {
  return [...(entry.teams ?? [])].sort((a, b) => compare(b.lastDate, a.lastDate) || b.games - a.games || compare(a.team, b.team))[0] ?? null;
}

/** The role with the most games (ties by Top, Jungle, Mid, Bot, Support order, which is the key order of `roles`). */
function mainRole(entry) {
  let best = null;
  for (const [role, games] of Object.entries(entry.roles ?? {})) if (best === null || games > best.games) best = { role, games };
  return best?.role ?? null;
}

function teamKeys(teamMap, teamId) {
  const entry = teamId ? teamMap?.teams?.[teamId] : null;
  if (!entry) return new Set();
  return new Set([entry.title, entry.name].filter(Boolean).map((v) => compactKey(stripParenthetical(v))).filter(Boolean));
}

function nameKeys(link, entry) {
  return new Set([stripParenthetical(link), ...(entry.names ?? [])].map(compactKey).filter(Boolean));
}

/**
 * @param input.index Leaguepedia index (`<rows>.players.json` `players`)
 * @param input.players game players (game-world.mjs)
 * @param input.teamMap parsed scripts/world/team-map.json
 * @param input.pins parsed scripts/stats/pins.json
 */
export function matchPlayers({ index, players, teamMap, pins = {} }) {
  const links = Object.keys(index).sort(compare);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const byName = new Map();
  for (const player of players) {
    const key = compactKey(player.match_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(player);
  }

  const pinIssues = [];
  const matches = [];
  const pinnedLinks = new Set();
  const pinnedPlayers = new Set();
  for (const link of Object.keys(pins).sort(compare)) {
    const target = pins[link];
    pinnedLinks.add(link);
    if (!index[link]) pinIssues.push(`${link}: link is not in the Leaguepedia index`);
    else if (target === null) continue;
    else if (!playerById.has(target)) pinIssues.push(`${link}: pinned player ${JSON.stringify(target)} is not in the game world`);
    else if (pinnedPlayers.has(target)) pinIssues.push(`${link}: player ${JSON.stringify(target)} is already pinned by another link`);
    else {
      matches.push({ link, playerId: target, via: "pin" });
      pinnedPlayers.add(target);
    }
  }

  // Per link: IGN candidates and which of them qualify.
  const evaluated = [];
  const unmatched = [];
  for (const link of links) {
    if (pinnedLinks.has(link)) continue;
    const entry = index[link];
    const seen = new Set();
    const candidates = [];
    for (const key of nameKeys(link, entry)) {
      for (const player of byName.get(key) ?? []) {
        if (seen.has(player.id) || pinnedPlayers.has(player.id)) continue;
        seen.add(player.id);
        candidates.push(player);
      }
    }
    const latest = latestTeam(entry);
    if (candidates.length === 0) {
      unmatched.push({ link, games: entry.games, names: entry.names ?? [], team: latest?.team ?? null, competition: latest?.competition ?? null });
      continue;
    }
    const latestKey = latest ? compactKey(stripParenthetical(latest.team)) : "";
    const role = mainRole(entry);
    const rows = candidates
      .sort((a, b) => compare(a.id, b.id))
      .map((player) => {
        const teamOk = latestKey !== "" && teamKeys(teamMap, player.team_id).has(latestKey);
        const roleCompetitionOk = role !== null && roleOfPosition(player.position) === role && player.competition !== null && player.competition === latest?.competition;
        return { player, teamOk, roleCompetitionOk };
      });
    evaluated.push({ link, rows });
  }

  const claims = new Map();
  for (const { link, rows } of evaluated) {
    for (const row of rows) {
      if (!(row.teamOk || row.roleCompetitionOk)) continue;
      if (!claims.has(row.player.id)) claims.set(row.player.id, []);
      claims.get(row.player.id).push(link);
    }
  }

  const review = [];
  for (const { link, rows } of evaluated) {
    const qualified = rows.filter((r) => r.teamOk || r.roleCompetitionOk);
    if (qualified.length === 1 && claims.get(qualified[0].player.id).length === 1) {
      matches.push({ link, playerId: qualified[0].player.id, via: qualified[0].teamOk ? "team" : "role-competition" });
      continue;
    }
    const reason = qualified.length === 0 ? "team_and_role_mismatch" : qualified.length > 1 ? "ambiguous_game_players" : "ambiguous_links";
    review.push({
      link,
      reason,
      candidates: rows.map(({ player, teamOk, roleCompetitionOk }) => ({
        id: player.id,
        matchName: player.match_name,
        teamId: player.team_id,
        competition: player.competition,
        position: player.position,
        teamOk,
        roleCompetitionOk,
      })),
    });
  }

  matches.sort((a, b) => compare(a.link, b.link));
  unmatched.sort((a, b) => b.games - a.games || compare(a.link, b.link));
  return { matches, review, unmatched, pinIssues };
}
