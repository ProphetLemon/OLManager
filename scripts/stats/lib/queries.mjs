// Pure Cargo query builder and answer parser for per-game Leaguepedia rows.
// No I/O. Tables: ScoreboardPlayers (SP, one row per player per game) joined to ScoreboardGames (SG).

/** Characters allowed in an OverviewPage prefix: letters, digits, space, / . _ - ' only. */
export const PREFIX_PATTERN = /^[A-Za-z0-9 /._'-]+$/;
export const MAX_PREFIX_LENGTH = 100;
export const MAX_PAGE_SIZE = 5000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD (rejects 2024-13-45 and 2023-02-29). */
export function isValidIsoDate(value) {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Throws unless the prefix is non-empty, short and made only of the allowed characters. */
export function assertValidPrefix(prefix) {
  if (typeof prefix !== "string" || prefix.length === 0 || prefix.length > MAX_PREFIX_LENGTH || !PREFIX_PATTERN.test(prefix)) {
    throw new Error(`invalid OverviewPage prefix ${JSON.stringify(prefix)}: use 1-${MAX_PREFIX_LENGTH} letters, digits, spaces and / . _ - '`);
  }
}

/** SQL string literal: single quotes doubled. Callers validate the content first; this is defence in depth. */
export function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Select list as [expression, alias]. Aliases keep the answer keys free of Cargo's space-for-underscore renaming.
 * Player Link is the stable identity; the team damage total is NOT a field (there is none), so it is summed later.
 */
export const FIELDS = Object.freeze([
  ["SP.OverviewPage", "OverviewPage"],
  ["SP.GameId", "GameId"],
  ["SP.Link", "Link"],
  ["SP.Name", "Name"],
  ["SP.Team", "Team"],
  ["SP.Role", "Role"],
  ["SP.Side", "Side"],
  ["SP.Kills", "Kills"],
  ["SP.Deaths", "Deaths"],
  ["SP.Assists", "Assists"],
  ["SP.Gold", "Gold"],
  ["SP.CS", "CS"],
  ["SP.DamageToChampions", "DamageToChampions"],
  ["SP.VisionScore", "VisionScore"],
  ["SP.TeamKills", "TeamKills"],
  ["SP.TeamGold", "TeamGold"],
  ["SP.DateTime_UTC", "DateTimeUtc"],
  ["SG.Gamelength_Number", "GameMinutes"],
]);

/**
 * Offset paging needs a total, stable order. SP.GameRoleId looks like the natural key, but its format is not in the
 * probe output, so uniqueness per row is unverified. Instead: a game has two sides with one row per role each, so
 * GameId + Side + Role identifies a row; Name breaks the tie in the rare case of a duplicated role label.
 */
export const ORDER_BY = "SP.GameId,SP.Side,SP.Role,SP.Name";

/** WHERE clause: date window (end exclusive) AND one competition's OverviewPage prefixes joined with OR. */
export function buildWhere({ since, until, prefixes }) {
  if (!isValidIsoDate(since)) throw new Error(`invalid since date ${JSON.stringify(since)}: use a real YYYY-MM-DD`);
  if (!isValidIsoDate(until)) throw new Error(`invalid until date ${JSON.stringify(until)}: use a real YYYY-MM-DD`);
  if (since >= until) throw new Error(`since (${since}) must be earlier than until (${until})`);
  if (!Array.isArray(prefixes) || prefixes.length === 0) throw new Error("at least one OverviewPage prefix is required");
  for (const prefix of prefixes) assertValidPrefix(prefix);
  const like = prefixes.map((prefix) => `SP.OverviewPage LIKE ${sqlString(`${prefix}%`)}`).join(" OR ");
  return `SP.DateTime_UTC >= ${sqlString(since)} AND SP.DateTime_UTC < ${sqlString(until)} AND (${like})`;
}

/** Cargo params for ONE page of per-game rows. */
export function scoreboardPageParams({ since, until, prefixes, offset, pageSize }) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new Error(`pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
  return {
    action: "cargoquery",
    tables: "ScoreboardPlayers=SP,ScoreboardGames=SG",
    join_on: "SP.GameId=SG.GameId",
    fields: FIELDS.map(([expression, alias]) => `${expression}=${alias}`).join(","),
    where: buildWhere({ since, until, prefixes }),
    order_by: ORDER_BY,
    limit: String(pageSize),
    offset: String(offset),
  };
}

const text = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
};

/** Parses a plain decimal number; empty or malformed values become null. */
const number = (value) => {
  const raw = text(value);
  if (raw === null || !/^[+-]?\d+(\.\d+)?$/.test(raw)) return null;
  return Number(raw);
};

/** Maps a cargoquery answer to typed raw rows. Throws when the answer has no `cargoquery` array. */
export function rowsFromCargo(data) {
  if (!data || !Array.isArray(data.cargoquery)) throw new Error("unexpected cargoquery answer: no cargoquery array");
  return data.cargoquery.map(({ title }) => ({
    overviewPage: text(title.OverviewPage),
    gameId: text(title.GameId),
    link: text(title.Link),
    name: text(title.Name),
    team: text(title.Team),
    role: text(title.Role),
    side: number(title.Side),
    kills: number(title.Kills),
    deaths: number(title.Deaths),
    assists: number(title.Assists),
    gold: number(title.Gold),
    cs: number(title.CS),
    damageToChampions: number(title.DamageToChampions),
    visionScore: number(title.VisionScore),
    teamKills: number(title.TeamKills),
    teamGold: number(title.TeamGold),
    dateTime: text(title.DateTimeUtc),
    gameMinutes: number(title.GameMinutes),
  }));
}
