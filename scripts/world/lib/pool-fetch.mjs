// Leaguepedia queries for the active-pros pool. The shapes of the tournament, roster-size and games queries are the
// ones scripts/world/pool-scope.mjs recorded in its cache; the people query adds the tournament list and a Players-page
// filter (both checked against the live API: the page filter returned the same rows as filtering locally).
import { OfflineCacheMissError, RequestBudgetExceededError } from "./mediawiki-client.mjs";
import {
  NOT_QUALIFIER_CLAUSE, TOURS_SEPARATOR, cargoClasses, classifyTournaments, mergePerson, normalizeTournament, pageClauses, personFromRow,
} from "./pool-scope.mjs";
import { DEFAULT_POOL_SINCE, DEFAULT_QUALIFIER_CAP, poolTournaments } from "./pool.mjs";

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
 * @param {number} [input.cap] largest roster a qualifier-flagged tournament may have
 * @param {string} [input.probe] Leaguepedia page of a person whose roster entries the report explains
 * @param {(message: string) => void} [input.log]
 */
export async function fetchPoolInputs({ client, since = DEFAULT_POOL_SINCE, cap = DEFAULT_QUALIFIER_CAP, probe = "", log = () => {} }) {
  const warnings = [];

  const tournamentRows = await cargoAll(client, {
    tables: "Tournaments=T,Leagues=L",
    join_on: "T.League=L.League",
    fields: "T.OverviewPage,T.Name,T.League,T.Region,T.TournamentLevel,T.IsOfficial,T.IsQualifier,T.IsPlayoffs,T.Split,T.SplitNumber,T.DateStart,T.Date,T.EventType,T.Year,T.Country,L.Level=LLevel,L.IsOfficial=LOfficial",
    where: `T.DateStart >= "${since}"`,
    order_by: "T.DateStart,T.OverviewPage",
  });
  const tournaments = [...new Map(tournamentRows.map((row) => [row.OverviewPage, normalizeTournament(row)])).values()];
  const classes = classifyTournaments(tournaments);
  log(`pool: ${tournaments.length} tournaments since ${since}`);

  const entryRows = await cargoAll(client, {
    tables: "TournamentPlayers=TP,Tournaments=T",
    join_on: "TP.OverviewPage=T.OverviewPage",
    fields: "T.OverviewPage,COUNT(*)=n",
    where: `T.DateStart >= "${since}"`,
    group_by: "T.OverviewPage",
    order_by: "T.OverviewPage",
  });
  const entryCount = new Map(entryRows.map((row) => [row.OverviewPage, Number(row.n)]));
  const view = poolTournaments(tournaments, classes, entryCount, cap);

  // Disjoint classes: official tournaments that are not qualifier-flagged, unflagged seasonal-league tournaments (second
  // divisions), and the small qualifier-flagged official ones (promotions, closed stages) picked by page.
  const parts = cargoClasses(tournaments, since);
  const classClauses = {
    official: parts.official.map((where) => `${where} AND ${NOT_QUALIFIER_CLAUSE}`),
    seasonal: parts.seasonal,
    qualifiers: pageClauses(view.split.small),
  };
  const people = new Map();
  const requests = {};
  for (const [name, clauses] of Object.entries(classClauses)) {
    requests[name] = clauses.length;
    for (const where of clauses) {
      const rows = await cargoAll(client, {
        tables: PEOPLE_TABLES, join_on: PEOPLE_JOIN, where: `${where} AND ${PEOPLE_FILTER}`, fields: PEOPLE_FIELDS, group_by: PEOPLE_GROUP, order_by: "TP.Player",
      });
      for (const person of rows.map(personFromRow)) people.set(person.page, people.has(person.page) ? mergePerson(people.get(person.page), person) : person);
      log(`pool: ${name} clause ${requests[name]} -> ${people.size} people so far`);
    }
  }

  let games = null;
  try {
    const gameRows = await cargoAll(client, {
      tables: "ScoreboardPlayers=SP", fields: "SP.Link,COUNT(*)=n", where: `SP.DateTime_UTC >= "${since} 00:00:00"`, group_by: "SP.Link", order_by: "SP.Link",
    });
    games = new Map(gameRows.map((row) => [row.Link, Number(row.n)]));
  } catch (error) {
    if (isFatal(error)) throw error;
    warnings.push(`pool: game counts unavailable (${error instanceof OfflineCacheMissError ? "not in the offline cache" : error.message}); pool ops carry games: null`);
  }

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
    since, cap, tournaments, classes, entryCount, view, people, games, probe: probe ? { page: probe, entries: probeEntries } : null, requests, warnings,
  };
}
