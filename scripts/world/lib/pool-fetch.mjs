// Leaguepedia queries for the active-pros pool. The shapes of the tournament, roster-size and games queries are the
// ones scripts/world/pool-scope.mjs recorded in its cache; the people query adds the tournament list and a Players-page
// filter (both checked against the live API: the page filter returned the same rows as filtering locally).
import { OfflineCacheMissError, RequestBudgetExceededError } from "./mediawiki-client.mjs";
import {
  NOT_QUALIFIER_CLAUSE, TOURS_SEPARATOR, aliasTargets, cargoClasses, chunkNames, classifyTournaments, foldGames, inPoolWindow, listedSince, mergePerson, normalizeTournament, pageClauses, personFromRow, quoteName,
} from "./pool-scope.mjs";
import { DEFAULT_POOL_SINCE, DEFAULT_QUALIFIER_CAP, poolTournaments } from "./pool.mjs";
import { LISTED_COMPETITION } from "./pool-rating.mjs";
import { normalizeRows } from "../../stats/lib/normalize.mjs";
import { FIELDS, ORDER_BY, rowsFromCargo } from "../../stats/lib/queries.mjs";

const PAGE = 500;
const PEOPLE_TABLES = "TournamentPlayers=TP,Tournaments=T,Leagues=L,Players=P";
const PEOPLE_JOIN = "TP.OverviewPage=T.OverviewPage,T.League=L.League,TP.Player=P.OverviewPage";
/** Not retired (or no retirement recorded) and the person has a Players page: the pool needs its country, birth date and role. */
export const PEOPLE_FILTER = '(P.IsRetired="0" OR P.IsRetired IS NULL) AND P.ID IS NOT NULL';
export const PEOPLE_FIELDS =
  "TP.Player=player,P.ID=ign,P.Name=name,P.Country=country,P.NationalityPrimary=nat,P.Birthdate=birth,P.Residency=res,P.Role=prole,P.Team=team," +
  "MIN(TP.Role)=rmin,MAX(TP.Role)=rmax,MAX(T.DateStart)=last,COUNT(*)=n,MIN(L.Level)=lmin,MIN(T.TournamentLevel)=tmin,MAX(T.IsOfficial)=toff,MAX(L.IsOfficial)=loff,MAX(T.Region)=region," +
  `GROUP_CONCAT(DISTINCT T.OverviewPage SEPARATOR '${TOURS_SEPARATOR}')=tours`;
export const PEOPLE_GROUP = "TP.Player,P.ID,P.Name,P.Country,P.NationalityPrimary,P.Birthdate,P.Residency,P.Role,P.Team";
// The same people query, but a roster row under an old name reaches the player's page through `PlayerRedirects`; `alias` is the name on the row.
const ALIAS_TABLES = "TournamentPlayers=TP,Tournaments=T,Leagues=L,PlayerRedirects=PR,Players=P";
const ALIAS_JOIN = "TP.OverviewPage=T.OverviewPage,T.League=L.League,TP.Player=PR.AllName,PR.OverviewPage=P.OverviewPage";
const ALIAS_ONLY = "PR.AllName<>PR.OverviewPage";
const ALIAS_FIELDS = PEOPLE_FIELDS.replace("TP.Player=player", "PR.OverviewPage=player,TP.Player=alias");
const ALIAS_GROUP = PEOPLE_GROUP.replace("TP.Player", "TP.Player,PR.OverviewPage");

/** Errors that mean "stop the run" rather than "this optional answer is unavailable". */
const isFatal = (error) => error instanceof RequestBudgetExceededError;

/** Every page of a cargoquery; stops at the first short page. */
export async function cargoAll(client, params) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const data = await client.get({ action: "cargoquery", format: "json", limit: String(PAGE), offset: String(offset), ...params });
    if (data.error) throw new Error(`cargoquery failed: ${data.error.code}`);
    const page = (data.cargoquery ?? []).map((row) => row.title);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/**
 * Everything the pool needs from Leaguepedia, in this order: the tournaments of the window, their roster sizes (for the
 * qualifier cap), the people of each tournament class, the games per player and, optionally, one person's roster entries.
 * A failed optional answer (games, probe) becomes a warning; a failed required one throws.
 *
 * @param {object} input
 * @param {{get(params: object): Promise<any>}} input.client
 * @param {string} [input.since] first tournament start date
 * @param {string} [input.listedFrom] first start date of the listed events (pool-events.mjs); the earlier of `since` and 2023-06-01 by default.
 *   An explicit `--pool-since` is passed as both: it is then the limit for everything
 * @param {boolean} [input.listedGames] also read the scoreboard rows of the listed events (the pooled stats of a run with `--pool-stats`)
 * @param {number} [input.cap] largest roster a qualifier-flagged tournament may have
 * @param {string} [input.probe] Leaguepedia page of a person whose roster entries the report explains
 * @param {(message: string) => void} [input.log]
 */
export async function fetchPoolInputs({ client, since = DEFAULT_POOL_SINCE, listedFrom = listedSince(since), cap = DEFAULT_QUALIFIER_CAP, probe = "", listedGames = false, log = () => {} }) {
  const warnings = [];

  // The listed events (pool-events.mjs) are read from their own, earlier date; everything else from `since`. Both lists are asked for
  // from the earlier one, and the tournaments of other leagues before `since` are dropped before anything is counted.
  const from = listedFrom < since ? listedFrom : since;
  const tournamentRows = await cargoAll(client, {
    tables: "Tournaments=T,Leagues=L",
    join_on: "T.League=L.League",
    fields: "T.OverviewPage,T.Name,T.League,T.Region,T.TournamentLevel,T.IsOfficial,T.IsQualifier,T.IsPlayoffs,T.Split,T.SplitNumber,T.DateStart,T.Date,T.EventType,T.Year,T.Country,L.Level=LLevel,L.IsOfficial=LOfficial",
    where: `T.DateStart >= "${from}"`,
    order_by: "T.DateStart,T.OverviewPage",
  });
  const tournaments = inPoolWindow([...new Map(tournamentRows.map((row) => [row.OverviewPage, normalizeTournament(row)])).values()], since, listedFrom);
  const classes = classifyTournaments(tournaments);
  log(`pool: ${tournaments.length} tournaments since ${since}`);

  const entryRows = await cargoAll(client, {
    tables: "TournamentPlayers=TP,Tournaments=T",
    join_on: "TP.OverviewPage=T.OverviewPage",
    fields: "T.OverviewPage,COUNT(*)=n",
    where: `T.DateStart >= "${from}"`,
    group_by: "T.OverviewPage",
    order_by: "T.OverviewPage",
  });
  const entryCount = new Map(entryRows.map((row) => [row.OverviewPage, Number(row.n)]));
  const view = poolTournaments(tournaments, classes, entryCount, cap);

  // Disjoint classes: official tournaments that are not qualifier-flagged, unflagged seasonal-league tournaments (second
  // divisions), the unflagged tournaments of the listed events, and the small qualifier-flagged ones (promotions, closed stages) picked by page.
  const parts = cargoClasses(tournaments, since, listedFrom);
  const classClauses = {
    official: parts.official.map((where) => `${where} AND ${NOT_QUALIFIER_CLAUSE}`),
    seasonal: parts.seasonal,
    ...(parts.listed.length > 0 ? { listed: parts.listed } : {}),
    qualifiers: pageClauses(view.split.small),
  };
  const people = new Map();
  const requests = {};
  const addPerson = (person) => people.set(person.page, people.has(person.page) ? mergePerson(people.get(person.page), person) : person);
  for (const [name, clauses] of Object.entries(classClauses)) {
    requests[name] = clauses.length;
    for (const where of clauses) {
      const rows = await cargoAll(client, {
        tables: PEOPLE_TABLES, join_on: PEOPLE_JOIN, where: `${where} AND ${PEOPLE_FILTER}`, fields: PEOPLE_FIELDS, group_by: PEOPLE_GROUP, order_by: "TP.Player",
      });
      for (const person of rows.map(personFromRow)) addPerson(person);
      log(`pool: ${name} clause ${requests[name]} -> ${people.size} people so far`);
    }
  }

  // Old names: roster and scoreboard rows keep the name used at the time. One paged read of the whole redirects table (a page's own
  // name has a row, which is how a name that is someone else's page is told from an old name), then the people query again through them.
  // A failed read turns the whole step off, with a warning. Nothing is merged or folded until every read is in and the names to be followed
  // have been checked against the Players table (below).
  const aliases = { names: 0, ambiguous: [], rosterRows: 0, dropped: 0, targets: new Map(), followed: [] };
  let targets = new Map();
  try {
    const redirectRows = await cargoAll(client, {
      tables: "PlayerRedirects=PR", fields: "PR.AllName=AllName,PR.OverviewPage=OverviewPage", order_by: "PR.AllName,PR.OverviewPage",
    });
    ({ targets, ambiguous: aliases.ambiguous } = aliasTargets(redirectRows));
  } catch (error) {
    if (isFatal(error)) throw error;
    warnings.push(`pool: redirects unavailable (${error instanceof OfflineCacheMissError ? "not in the offline cache" : error.message}); old names are not followed`);
  }
  const aliasRows = [];
  if (targets.size > 0) {
    try {
      for (const clauses of Object.values(classClauses)) {
        for (const where of clauses) {
          aliasRows.push(...await cargoAll(client, {
            tables: ALIAS_TABLES, join_on: ALIAS_JOIN, where: `${where} AND ${ALIAS_ONLY} AND ${PEOPLE_FILTER}`, fields: ALIAS_FIELDS, group_by: ALIAS_GROUP, order_by: "TP.Player",
          }));
        }
      }
    } catch (error) {
      if (isFatal(error)) throw error;
      aliasRows.length = 0;
      warnings.push(`pool: roster rows under old names unavailable (${error instanceof OfflineCacheMissError ? "not in the offline cache" : error.message}); the games are still folded`);
    }
  }

  let gameCounts = null;
  try {
    const gameRows = await cargoAll(client, {
      tables: "ScoreboardPlayers=SP", fields: "SP.Link,COUNT(*)=n", where: `SP.DateTime_UTC >= "${since} 00:00:00"`, group_by: "SP.Link", order_by: "SP.Link",
    });
    gameCounts = new Map(gameRows.map((row) => [row.Link, Number(row.n)]));
  } catch (error) {
    if (isFatal(error)) throw error;
    warnings.push(`pool: game counts unavailable (${error instanceof OfflineCacheMissError ? "not in the offline cache" : error.message}); pool ops carry games: null`);
  }

  // The listed events' own stats rows: every game of their tournaments from `listedFrom`, normalized into one pooled competition. An event
  // with no game-level data adds no rows; rows dropped by the normalizer (a team without five rows or without a damage column) are counted
  // by reason. Old names are folded later, by the pipeline, with the same map as every other stats row.
  let listedRows = [];
  const listedStats = { requested: listedGames, read: false, pages: 0, inputRows: 0, rows: 0, dropped: {} };
  const listedPages = listedGames ? tournaments.filter((t) => classes.get(t.page)?.listed).map((t) => t.page) : [];
  listedStats.pages = listedPages.length;
  if (listedPages.length > 0) {
    try {
      const raw = [];
      for (const chunk of chunkNames(listedPages)) {
        raw.push(...await cargoAll(client, {
          tables: "ScoreboardPlayers=SP,ScoreboardGames=SG", join_on: "SP.GameId=SG.GameId", fields: FIELDS.map(([expression, alias]) => `${expression}=${alias}`).join(","),
          where: `SP.DateTime_UTC >= "${listedFrom} 00:00:00" AND SP.OverviewPage IN (${chunk.map(quoteName).join(",")})`, order_by: ORDER_BY,
        }));
      }
      const normalized = normalizeRows(rowsFromCargo({ cargoquery: raw.map((title) => ({ title })) }), { competition: LISTED_COMPETITION });
      listedRows = normalized.rows;
      Object.assign(listedStats, { read: true, inputRows: normalized.stats.inputRows, rows: normalized.stats.rows, dropped: normalized.dropped });
      const droppedTotal = Object.values(normalized.dropped).reduce((sum, n) => sum + n, 0);
      if (droppedTotal > 0) {
        warnings.push(`pool: listed events: ${droppedTotal} of ${normalized.stats.inputRows} scoreboard rows were dropped (${Object.entries(normalized.dropped).map(([reason, n]) => `${reason}: ${n}`).join(", ")}); the people in them have no rows`);
      }
      log(`pool: listed events -> ${listedRows.length} stats rows from ${listedPages.length} tournaments`);
    } catch (error) {
      if (isFatal(error)) throw error;
      warnings.push(`pool: stats of the listed events unavailable (${error instanceof OfflineCacheMissError ? "not in the offline cache" : error.message}); their people keep the default`);
    }
  } else if (listedGames) {
    listedStats.read = true;
  }

  // A name is followed only if no other Players page carries it: the redirects table need not have a row for every page, so a name that is
  // someone's own page can still show up as an old name of another. Ask the Players table about every name whose target is a pool page
  // (the pipeline folds the game competitions' stats rows with the same map, so "the names the data uses" would miss some). The table
  // matches page names without regard to case: of the pages it returns for a name, any that is not the name's own target makes the
  // name ambiguous (a link `vicky` for the page `Vicky` is the person's own spelling and is followed). Nothing is followed if the table
  // cannot be read.
  if (targets.size > 0) {
    const poolPages = new Set([...people.keys(), ...aliasRows.map((r) => r.player)]);
    const names = [...targets.keys()].filter((name) => poolPages.has(targets.get(name))).sort();
    try {
      const pagesByLower = new Map();
      for (const chunk of chunkNames(names)) {
        const rows = await cargoAll(client, { tables: "Players=P", fields: "P.OverviewPage=page", where: `P.OverviewPage IN (${chunk.map(quoteName).join(",")})`, order_by: "P.OverviewPage" });
        for (const found of rows) {
          const key = found.page.toLowerCase();
          if (!pagesByLower.has(key)) pagesByLower.set(key, new Set());
          pagesByLower.get(key).add(found.page);
        }
      }
      const dropped = names.filter((name) => [...(pagesByLower.get(name.toLowerCase()) ?? [])].some((page) => page !== targets.get(name)));
      for (const name of dropped) targets.delete(name);
      aliases.ambiguous = [...new Set([...aliases.ambiguous, ...dropped])].sort();
    } catch (error) {
      if (isFatal(error)) throw error;
      targets = new Map();
      warnings.push(`pool: Players table unavailable (${error instanceof OfflineCacheMissError ? "not in the offline cache" : error.message}); old names are not followed`);
    }
  }
  aliases.targets = targets;
  aliases.names = targets.size;

  // The join hands a name two pages claim to both of them, and a name that is a page of its own (found by the plain query above) to the
  // page it redirects to: neither is the same person, so only a name that is still followed and has no page of its own is merged.
  const own = new Set(people.keys());
  const brought = new Map();
  for (const aliasRow of aliasRows) {
    if (targets.get(aliasRow.alias) !== aliasRow.player || own.has(aliasRow.alias)) aliases.dropped += 1;
    else {
      addPerson(personFromRow(aliasRow));
      aliases.rosterRows += 1;
      brought.set(aliasRow.alias, (brought.get(aliasRow.alias) ?? 0) + (Number(aliasRow.n) || 0));
    }
  }
  if (targets.size > 0) log(`pool: old names -> ${aliases.rosterRows} roster rows merged, ${aliases.dropped} dropped`);
  const games = gameCounts ? foldGames(gameCounts, targets, (name) => people.has(name)) : null;
  const seen = new Set([...brought.keys(), ...(gameCounts?.keys() ?? []), ...listedRows.map((r) => r.playerKey)]);
  aliases.followed = [...seen]
    .filter((name) => targets.has(name) && !own.has(name) && people.has(targets.get(name)))
    .sort()
    .map((name) => ({ name, page: targets.get(name), entries: brought.get(name) ?? 0, games: gameCounts?.get(name) ?? 0, rows: listedRows.filter((r) => r.playerKey === name).length }));

  let probeEntries = null;
  if (probe) {
    try {
      const rows = await cargoAll(client, { tables: "TournamentPlayers=TP", fields: "TP.OverviewPage=page,TP.Role=role", where: `TP.Player=${JSON.stringify(probe)}`, order_by: "TP.OverviewPage" });
      probeEntries = rows.map((row) => ({ page: row.page, role: row.role }));
    } catch (error) {
      if (isFatal(error)) throw error;
      warnings.push(`pool: roster entries of ${probe} unavailable (${error instanceof OfflineCacheMissError ? "not in the offline cache" : error.message})`);
    }
  }

  return {
    since, cap, tournaments, classes, entryCount, view, people, games, aliases, listedRows, listedStats, probe: probe ? { page: probe, entries: probeEntries } : null, requests, warnings,
  };
}
