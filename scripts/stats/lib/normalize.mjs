// Pure normalization of raw per-game rows into the skill model's GameRow shape (see skill.d.mts).
// No I/O, no clock. Every dropped row is counted by reason; output order does not depend on input order.
import { isValidIsoDate } from "./queries.mjs";

export const ROLE_MAP = Object.freeze({ Top: "Top", Jungle: "Jungle", Mid: "Mid", Bot: "Bot", Support: "Support" });
const ROLE_ORDER = Object.freeze(["Top", "Jungle", "Mid", "Bot", "Support"]);
export const TEAM_SIZE = 5;

export const DROP_REASONS = Object.freeze({
  duplicate: "duplicate row",
  teamSize: "team without exactly 5 rows",
  teamDamage: "team damage incomplete",
  role: "bad role",
  date: "bad date",
  minutes: "missing minutes",
  link: "missing player link",
  stat: "missing stat",
});

/** YYYY-MM-DD from a Leaguepedia "YYYY-MM-DD HH:MM:SS" timestamp, or null when absent or impossible. */
export function dateOf(dateTime) {
  if (typeof dateTime !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(dateTime.trim());
  return match && isValidIsoDate(match[1]) ? match[1] : null;
}

const isCount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param rows raw rows from rowsFromCargo (all pages of one competition, so each game is complete)
 * @param options.competition OLManager competition id stamped on every output row
 * @returns {rows, dropped, stats} with rows in the T3 GameRow shape
 */
export function normalizeRows(rows, { competition }) {
  if (typeof competition !== "string" || competition === "") throw new Error("competition is required");
  const dropped = {};
  const drop = (reason, count = 1) => {
    dropped[reason] = (dropped[reason] ?? 0) + count;
  };

  // 1. Deduplicate (offset paging over a live wiki can repeat a row): first row in a fixed order wins.
  const rowKey = (r) => [r.gameId, r.side, r.role, r.name, r.team].join("\u0000");
  const ordered = [...rows].sort((a, b) => compare(rowKey(a), rowKey(b)));
  const unique = [];
  const seen = new Set();
  for (const row of ordered) {
    const key = rowKey(row);
    if (seen.has(key)) drop(DROP_REASONS.duplicate);
    else {
      seen.add(key);
      unique.push(row);
    }
  }

  // 2. Team groups: exactly 5 rows and a complete damage column, otherwise the team total is unknowable.
  const teams = new Map();
  for (const row of unique) {
    const key = `${row.gameId}\u0000${row.team}`;
    if (!teams.has(key)) teams.set(key, []);
    teams.get(key).push(row);
  }
  const teamDamage = new Map();
  for (const [key, members] of teams) {
    if (members.length !== TEAM_SIZE) drop(DROP_REASONS.teamSize, members.length);
    else if (!members.every((m) => isCount(m.damageToChampions))) drop(DROP_REASONS.teamDamage, members.length);
    else teamDamage.set(key, members.reduce((sum, m) => sum + m.damageToChampions, 0));
  }

  // 3. Per-row validation, first failing check wins.
  const kept = [];
  for (const row of unique) {
    const total = teamDamage.get(`${row.gameId}\u0000${row.team}`);
    if (total === undefined) continue;
    const role = ROLE_MAP[row.role];
    const date = dateOf(row.dateTime);
    if (!role) drop(DROP_REASONS.role);
    else if (!date) drop(DROP_REASONS.date);
    else if (!(typeof row.gameMinutes === "number" && Number.isFinite(row.gameMinutes) && row.gameMinutes > 0)) drop(DROP_REASONS.minutes);
    else if (!row.link) drop(DROP_REASONS.link);
    else if (![row.kills, row.deaths, row.assists, row.gold, row.cs, row.teamKills, row.teamGold].every(isCount)) drop(DROP_REASONS.stat);
    else if (row.visionScore !== null && !isCount(row.visionScore)) drop(DROP_REASONS.stat);
    else {
      kept.push({
        gameId: row.gameId,
        side: row.side ?? 0,
        source: row,
        out: {
          playerKey: row.link,
          competition,
          role,
          date,
          gameMinutes: row.gameMinutes,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          teamKills: row.teamKills,
          damageToChampions: row.damageToChampions,
          teamDamageToChampions: total,
          gold: row.gold,
          teamGold: row.teamGold,
          cs: row.cs,
          visionScore: row.visionScore,
        },
      });
    }
  }

  kept.sort(
    (a, b) =>
      compare(a.out.date, b.out.date) ||
      compare(a.gameId, b.gameId) ||
      a.side - b.side ||
      ROLE_ORDER.indexOf(a.out.role) - ROLE_ORDER.indexOf(b.out.role) ||
      compare(a.out.playerKey, b.out.playerKey),
  );
  const out = kept.map((k) => k.out);
  return {
    rows: out,
    index: indexPlayers(kept),
    dropped: Object.fromEntries(Object.entries(dropped).sort(([a], [b]) => compare(a, b))),
    stats: {
      inputRows: rows.length,
      rows: out.length,
      games: new Set(kept.map((k) => k.gameId)).size,
      players: new Set(out.map((r) => r.playerKey)).size,
    },
  };
}

const emptyEntry = () => ({ names: new Set(), teams: new Map(), roles: new Map(), games: 0, firstDate: null, lastDate: null });

function addTeam(entry, { team, competition, games, lastDate }) {
  if (!team) return;
  const key = `${team}\u0000${competition}`;
  const seen = entry.teams.get(key) ?? { team, competition, games: 0, lastDate: null };
  seen.games += games;
  if (seen.lastDate === null || lastDate > seen.lastDate) seen.lastDate = lastDate;
  entry.teams.set(key, seen);
}

function addRole(entry, role, games) {
  entry.roles.set(role, (entry.roles.get(role) ?? 0) + games);
  entry.games += games;
}

function widen(entry, firstDate, lastDate) {
  if (entry.firstDate === null || firstDate < entry.firstDate) entry.firstDate = firstDate;
  if (entry.lastDate === null || lastDate > entry.lastDate) entry.lastDate = lastDate;
}

/** Sorted, JSON-ready index: links, names, roles in fixed order; teams newest first (then most games, then name). */
function finalizeIndex(entries) {
  const out = {};
  for (const link of [...entries.keys()].sort(compare)) {
    const e = entries.get(link);
    out[link] = {
      names: [...e.names].sort(compare),
      teams: [...e.teams.values()].sort((a, b) => compare(b.lastDate, a.lastDate) || b.games - a.games || compare(a.team, b.team) || compare(a.competition, b.competition)),
      roles: Object.fromEntries(ROLE_ORDER.filter((role) => e.roles.has(role)).map((role) => [role, e.roles.get(role)])),
      games: e.games,
      firstDate: e.firstDate,
      lastDate: e.lastDate,
    };
  }
  return out;
}

/** Per Leaguepedia Link, built from the rows that survived validation: one kept row is one game of that player. */
function indexPlayers(kept) {
  const entries = new Map();
  for (const { source, out } of kept) {
    if (!entries.has(out.playerKey)) entries.set(out.playerKey, emptyEntry());
    const entry = entries.get(out.playerKey);
    if (source.name) entry.names.add(source.name);
    addTeam(entry, { team: source.team, competition: out.competition, games: 1, lastDate: out.date });
    addRole(entry, out.role, 1);
    widen(entry, out.date, out.date);
  }
  return finalizeIndex(entries);
}

/** Merges per-competition indexes (as returned in `normalizeRows(...).index`) into one, with the same ordering rules. */
export function mergePlayerIndexes(indexes) {
  const entries = new Map();
  for (const index of indexes) {
    for (const [link, e] of Object.entries(index)) {
      if (!entries.has(link)) entries.set(link, emptyEntry());
      const entry = entries.get(link);
      for (const name of e.names) entry.names.add(name);
      for (const team of e.teams) addTeam(entry, team);
      for (const [role, games] of Object.entries(e.roles)) addRole(entry, role, games);
      widen(entry, e.firstDate, e.lastDate);
    }
  }
  return finalizeIndex(entries);
}
