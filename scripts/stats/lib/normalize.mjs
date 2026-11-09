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
    dropped: Object.fromEntries(Object.entries(dropped).sort(([a], [b]) => compare(a, b))),
    stats: {
      inputRows: rows.length,
      rows: out.length,
      games: new Set(kept.map((k) => k.gameId)).size,
      players: new Set(out.map((r) => r.playerKey)).size,
    },
  };
}
