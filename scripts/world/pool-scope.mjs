#!/usr/bin/env node
// Maintainer tool: measure who the "active pros" pool would hold, per candidate tournament filter.
// Read-only: it queries Leaguepedia Cargo through the bot login and reads data/ and the reviewed maps. It writes
// scripts/world/out/pool-scope/report.{md,json} (ignored by git). The shipped game never runs it.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { MediaWikiClient, DEFAULT_THROTTLE_MS, formatStats } from "./lib/mediawiki-client.mjs";
import { loginFromFile } from "./lib/bot-credentials.mjs";
import { buildIndex, playerEntity, staffEntity } from "./lib/match.mjs";
import { loadTeamMap } from "./lib/team-map.mjs";
import { loadWorld } from "./lib/world.mjs";
import {
  CLASS_FILTERS, FILTERS, OPEN_QUALIFIER_ENTRIES, cargoClasses, pageClauses, qualifierSplit, classifyTournaments, evenSample, fieldCoverage, gameStatus, gameTeamKeys, mergePerson,
  normalizeTournament, personFromRow, share, summarizePeople, tournamentDays,
} from "./lib/pool-scope.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PAGE = 500;
const TABLES = ["Tournaments", "Leagues", "TournamentPlayers", "Players", "ScoreboardPlayers", "TournamentRosters"];

const { values } = parseArgs({
  options: {
    since: { type: "string", default: "2023-11-12" },
    offline: { type: "boolean", default: false },
    "cache-dir": { type: "string", default: path.join(ROOT, "scripts/world/.cache/pool-scope") },
    "out-dir": { type: "string", default: path.join(ROOT, "scripts/world/out/pool-scope") },
    "throttle-ms": { type: "string", default: String(DEFAULT_THROTTLE_MS) },
    "max-requests": { type: "string", default: "600" },
    "data-dir": { type: "string", default: path.join(ROOT, "data") },
    "team-map": { type: "string", default: path.join(ROOT, "scripts/world/team-map.json") },
    "id-map": { type: "string", default: path.join(ROOT, "scripts/world/id-map.json") },
    probe: { type: "string", default: "Send0o" },
  },
});

const client = new MediaWikiClient({
  cacheDir: values["cache-dir"],
  offline: values.offline,
  throttleMs: Number(values["throttle-ms"]),
  maxRequests: Number(values["max-requests"]),
  maxCacheAgeDays: 3650,
  log: (message) => console.error(message),
});
if (!values.offline) await loginFromFile(client, { log: (message) => console.error(message) });

const since = values.since;

/** Every page of a cargoquery; stops at the first short page. */
async function cargoAll(params) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const data = await client.get({ action: "cargoquery", format: "json", limit: String(PAGE), offset: String(offset), ...params });
    if (data.error) throw new Error(`cargoquery failed: ${data.error.code}`);
    const page = (data.cargoquery ?? []).map((row) => row.title);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

// 1. Fields that exist.
const fields = {};
for (const table of TABLES) {
  const data = await client.get({ action: "cargofields", format: "json", table });
  fields[table] = Object.keys(data.cargofields ?? {});
}

// 2. Every tournament in the window, with its league's curated level.
const tournamentRows = await cargoAll({
  tables: "Tournaments=T,Leagues=L",
  join_on: "T.League=L.League",
  fields: "T.OverviewPage,T.Name,T.League,T.Region,T.TournamentLevel,T.IsOfficial,T.IsQualifier,T.IsPlayoffs,T.Split,T.SplitNumber,T.DateStart,T.Date,T.EventType,T.Year,T.Country,L.Level=LLevel,L.IsOfficial=LOfficial",
  where: `T.DateStart >= "${since}"`,
  order_by: "T.DateStart,T.OverviewPage",
});
const tournaments = new Map();
for (const row of tournamentRows) tournaments.set(row.OverviewPage, normalizeTournament(row));
const tournamentList = [...tournaments.values()];
const classes = classifyTournaments(tournamentList);
const cargoParts = cargoClasses(tournamentList, since);

// 3. The Cargo clauses must select as many tournaments as the local predicate (classes are disjoint, so counts add up).
const clauseCheck = Object.fromEntries(FILTERS.map((f) => [f, { cargo: 0, local: tournamentList.filter((t) => classes.get(t.page)[f]).length }]));
for (const [name, clauses] of Object.entries(cargoParts)) {
  for (const where of clauses) {
    const [row] = await cargoAll({ tables: "Tournaments=T,Leagues=L", join_on: "T.League=L.League", fields: "COUNT(*)=n", where });
    for (const f of CLASS_FILTERS[name]) clauseCheck[f].cargo += Number(row.n);
  }
}

// 4. One row per non-retired person and class, with the profile fields the game needs. A person can sit in several classes.
const peopleTables = "TournamentPlayers=TP,Tournaments=T,Leagues=L,Players=P";
const peopleJoin = "TP.OverviewPage=T.OverviewPage,T.League=L.League,TP.Player=P.OverviewPage";
const active = '(P.IsRetired="0" OR P.IsRetired IS NULL)';
const personFields = "TP.Player=player,P.ID=ign,P.Name=name,P.Country=country,P.NationalityPrimary=nat,P.Birthdate=birth,P.Residency=res,P.Role=prole,P.Team=team,MIN(TP.Role)=rmin,MAX(TP.Role)=rmax,MAX(T.DateStart)=last,COUNT(*)=n,MIN(L.Level)=lmin,MIN(T.TournamentLevel)=tmin,MAX(T.IsOfficial)=toff,MAX(L.IsOfficial)=loff,MAX(T.Region)=region";
const byClass = {};
let otherDistinct = 0; // upper bound: people of the loose-only class, summed over its league chunks
for (const [name, clauses] of Object.entries(cargoParts)) {
  byClass[name] = new Map();
  for (const where of clauses) {
    if (name === "other") {
      // Leaguepedia answers about one heavy query a minute, so the loose-only class is counted, not listed.
      const [row] = await cargoAll({ tables: peopleTables, join_on: peopleJoin, where: `${where} AND ${active}`, fields: "COUNT(DISTINCT TP.Player)=n" });
      otherDistinct += Number(row.n);
      continue;
    }
    const rows = await cargoAll({
      tables: peopleTables, join_on: peopleJoin, where: `${where} AND ${active}`, fields: personFields,
      group_by: "TP.Player,P.ID,P.Name,P.Country,P.NationalityPrimary,P.Birthdate,P.Residency,P.Role,P.Team", order_by: "TP.Player",
    });
    for (const person of rows.map(personFromRow)) {
      const known = byClass[name].get(person.page);
      byClass[name].set(person.page, known ? mergePerson(known, person) : person);
    }
  }
}
/** The people of one filter: the union of its classes, merged per person. */
const peopleOf = (filter) => {
  const merged = new Map();
  for (const [name, list] of Object.entries(byClass)) {
    if (!CLASS_FILTERS[name].includes(filter)) continue;
    for (const [page, person] of list) merged.set(page, merged.has(page) ? mergePerson(merged.get(page), person) : person);
  }
  return merged;
};
const LISTED = ["strict", "recommended"];
const filterPeople = Object.fromEntries(LISTED.map((f) => [f, peopleOf(f)]));

// 4b. Sensitivity of the strict filter to open qualifiers: distinct people (summed over chunks, so an upper bound) in
// non-qualifier tournaments, in small qualifier-flagged ones (promotions, closed stages) and in open qualifiers.
const entryRows = await cargoAll({
  tables: "TournamentPlayers=TP,Tournaments=T",
  join_on: "TP.OverviewPage=T.OverviewPage",
  fields: "T.OverviewPage,COUNT(*)=n",
  where: `T.DateStart >= "${since}"`,
  group_by: "T.OverviewPage",
  order_by: "T.OverviewPage",
});
const entryCount = new Map(entryRows.map((row) => [row.OverviewPage, Number(row.n)]));
const split = qualifierSplit(tournamentList, classes, entryCount);
const distinct = async (wheres) => {
  let total = 0;
  for (const where of wheres) {
    const [row] = await cargoAll({ tables: peopleTables, join_on: peopleJoin, where: `${where} AND ${active}`, fields: "COUNT(DISTINCT TP.Player)=n" });
    total += Number(row.n);
  }
  return total;
};
const sensitivity = {
  entriesThreshold: OPEN_QUALIFIER_ENTRIES,
  strictTournaments: { nonQualifier: tournamentList.filter((t) => classes.get(t.page).strict && !t.qualifier).length, smallQualifiers: split.small.length, openQualifiers: split.open.length },
  strictDistinctPeople: {
    nonQualifier: await distinct(cargoParts.official.map((w) => `${w} AND (T.IsQualifier IS NULL OR T.IsQualifier="0")`)),
    smallQualifiers: await distinct(pageClauses(split.small)),
    openQualifiers: await distinct(pageClauses(split.open)),
  },
};

// 5b. The probe person's own roster entries, to show which tournaments each filter keeps.
const probeEntries = values.probe
  ? await cargoAll({ tables: "TournamentPlayers=TP", fields: "TP.OverviewPage=page,TP.Role=role", where: `TP.Player=${JSON.stringify(values.probe)}`, order_by: "TP.OverviewPage" })
  : [];

// 5. Games in the window per player page (the stats-based rating source needs at least 8, the report uses 1 and 10).
const gameRows = await cargoAll({
  tables: "ScoreboardPlayers=SP",
  fields: "SP.Link,COUNT(*)=n",
  where: `SP.DateTime_UTC >= "${since} 00:00:00"`,
  group_by: "SP.Link",
  order_by: "SP.Link",
});
const games = new Map(gameRows.map((row) => [row.Link, Number(row.n)]));

// 6. What the game has.
const world = loadWorld(values["data-dir"]);
const idMap = JSON.parse(fs.readFileSync(values["id-map"], "utf8"));
const context = {
  playerIndex: buildIndex(world.players.map(playerEntity)),
  staffIndex: buildIndex(world.staff.map(staffEntity)),
  overrides: idMap,
  teamKeys: gameTeamKeys(loadTeamMap(values["team-map"])),
};
const gameOf = new Map();
for (const person of filterPeople.recommended.values()) gameOf.set(person.page, gameStatus(person, context));
const fresh = (p) => gameOf.get(p.page).status === "new";

// --- Report ----------------------------------------------------------------------------------------
const describe = (t) => ({
  name: t.name, league: t.league, region: t.region, level: t.level, official: t.official, qualifier: t.qualifier,
  days: tournamentDays(t), start: t.start,
});
const tournamentCounts = Object.fromEntries(FILTERS.map((f) => [f, tournamentList.filter((t) => classes.get(t.page)[f]).length]));
const byLevel = {};
for (const f of FILTERS) {
  byLevel[f] = {};
  for (const t of tournamentList) if (classes.get(t.page)[f]) byLevel[f][t.level || "(empty)"] = (byLevel[f][t.level || "(empty)"] ?? 0) + 1;
}
const samples = {};
FILTERS.forEach((f, i) => {
  const stricter = FILTERS[i - 1];
  const looser = FILTERS[i + 1];
  const inside = tournamentList.filter((t) => classes.get(t.page)[f] && (!stricter || !classes.get(t.page)[stricter]));
  const outside = tournamentList.filter((t) => !classes.get(t.page)[f] && (!looser || classes.get(t.page)[looser]));
  const fallback = tournamentList.filter((t) => !classes.get(t.page)[f]);
  samples[f] = { includes: evenSample(inside, 15).map(describe), excludes: evenSample(outside.length >= 15 ? outside : fallback, 15).map(describe) };
});

const perFilter = {};
for (const f of LISTED) {
  const list = [...filterPeople[f].values()];
  const statusCounts = (kind) => {
    const of = list.filter((p) => p.kind === kind);
    return Object.fromEntries(["in-game", "on-game-team", "uncertain", "new"].map((x) => [x, of.filter((p) => gameOf.get(p.page).status === x).length]));
  };
  perFilter[f] = {
    all: summarizePeople(list),
    gameStatus: { player: statusCounts("player"), staff: statusCounts("staff") },
    pool: summarizePeople(list, { exclude: (p) => !fresh(p) }),
    poolWithProfilePage: summarizePeople(list, { exclude: (p) => !fresh(p) || !p.profile.ign }),
  };
}
const newPeople = [...filterPeople.recommended.values()].filter(fresh);
const coverage = {};
for (const kind of ["player", "staff"]) {
  const of = newPeople.filter((p) => p.kind === kind);
  const cov = (p) => fieldCoverage(p, games.get(p.page) ?? 0);
  coverage[kind] = {
    total: of.length,
    profilePage: share(of, (p) => cov(p).profilePage), birthDate: share(of, (p) => cov(p).birthDate), country: share(of, (p) => cov(p).country), residency: share(of, (p) => cov(p).residency),
    role: share(of, (p) => cov(p).role), anyGames: share(of, (p) => cov(p).anyGames), tenGames: share(of, (p) => cov(p).tenGames),
    birthCountryRole: share(of, (p) => cov(p).birthDate && cov(p).country && cov(p).role),
  };
}
const tierWithoutTenGames = {};
for (const p of newPeople.filter((x) => x.kind === "player" && (games.get(x.page) ?? 0) < 10)) tierWithoutTenGames[`tier ${p.tier}`] = (tierWithoutTenGames[`tier ${p.tier}`] ?? 0) + 1;

const probeReport = {
  page: values.probe,
  person: filterPeople.recommended.get(values.probe) ? { ...filterPeople.recommended.get(values.probe), game: gameOf.get(values.probe), games: games.get(values.probe) ?? 0 } : null,
  entries: probeEntries.map((e) => {
    const t = tournaments.get(e.page);
    return t ? { name: t.name, league: t.league, role: e.role, ...Object.fromEntries(FILTERS.map((f) => [f, classes.get(t.page)[f]])) } : { page: e.page, outsideWindow: true };
  }).filter((e) => !e.outsideWindow),
};

const report = {
  generatedAt: new Date().toISOString(),
  since,
  requests: client.statsSnapshot(),
  fields,
  tournaments: { total: tournamentList.length, byFilter: tournamentCounts, byLevel, clauseCheck },
  game: { players: world.players.length, staff: world.staff.length },
  perFilter,
  sensitivity,
  loose: { upperBoundPeople: filterPeople.recommended.size + otherDistinct, otherClassDistinctSum: otherDistinct, recommendedPeople: filterPeople.recommended.size },
  coverage,
  tierWithoutTenGames,
  samples,
  probe: probeReport,
  cargoClassSizes: Object.fromEntries(Object.entries(cargoParts).map(([k, v]) => [k, { requests: v.length, maxChars: Math.max(...v.map((c) => c.length)) }])),
};

fs.mkdirSync(values["out-dir"], { recursive: true });
fs.writeFileSync(path.join(values["out-dir"], "report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(values["out-dir"], "report.md"), renderMarkdown(report));
console.error(`pool-scope: ${formatStats(client.statsSnapshot())}; wrote ${values["out-dir"]}`);

function table(rowsIn, head) {
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const row of rowsIn) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}
function countTable(obj) {
  return table(Object.entries(obj), ["key", "people"]);
}
function sampleLine(s) {
  return `- ${s.name} (${s.league || "no league"}; ${s.region}; level ${s.level || "-"}; official ${s.official}; qualifier ${s.qualifier}; ${s.days}d)`;
}

function renderMarkdown(r) {
  const out = ["# Active-pros pool scope", "", `Window: tournaments starting on or after ${r.since}. Requests this run: ${JSON.stringify(r.requests)}.`, ""];
  out.push("## Fields found", "", ...Object.entries(r.fields).map(([t, f]) => `- ${t}: ${f.join(", ")}`), "");
  out.push("## Tournaments", "", `Total ${r.tournaments.total}.`, "");
  out.push(table(FILTERS.map((f) => [f, r.tournaments.byFilter[f], `${r.tournaments.clauseCheck[f].cargo} / ${r.tournaments.clauseCheck[f].local}`, JSON.stringify(r.tournaments.byLevel[f])]), ["filter", "tournaments", "Cargo clause / local", "by TournamentLevel"]), "");
  out.push(`## People per filter against the game (${r.game.players} players, ${r.game.staff} staff)`, "");
  out.push(`strict, open-qualifier sensitivity (qualifier-flagged tournaments with more than ${r.sensitivity.entriesThreshold} roster entries are open qualifiers): tournaments ${JSON.stringify(r.sensitivity.strictTournaments)}; distinct people (upper bounds, overlapping) ${JSON.stringify(r.sensitivity.strictDistinctPeople)}.`, "");
  out.push(`loose: upper bound ${r.loose.upperBoundPeople} people (recommended ${r.loose.recommendedPeople} + ${r.loose.otherClassDistinctSum} from the loose-only class, which overlaps); not listed because Leaguepedia limits heavy queries.`, "");
  out.push(table(LISTED.flatMap((f) => ["player", "staff"].map((k) => [f, k, r.perFilter[f].all[k === "player" ? "players" : "staff"], ...Object.values(r.perFilter[f].gameStatus[k])])), ["filter", "kind", "people", "in game", "on a game team", "uncertain", "new"]), "");
  for (const f of FILTERS) {
    if (!r.perFilter[f]) {
      out.push(`### ${f}`, "", "Tournament samples, included (borderline: not in the stricter filter):", "", ...r.samples[f].includes.map(sampleLine), "", "excluded:", "", ...r.samples[f].excludes.map(sampleLine), "");
      continue;
    }
    const pool = r.perFilter[f].pool;
    const withPage = r.perFilter[f].poolWithProfilePage;
    out.push(`### ${f}: pool of new people (${pool.players} players, ${pool.staff} staff; with a Players page: ${withPage.players} players, ${withPage.staff} staff)`, "", "by position", "", countTable(pool.byPosition), "", "by staff label", "", countTable(pool.byStaffLabel), "");
    out.push("by region (players)", "", countTable(pool.byRegion.player), "", "by region (staff)", "", countTable(pool.byRegion.staff), "", "by tier", "", countTable(pool.byTier), "");
    out.push("Tournament samples, included (borderline: not in the stricter filter):", "", ...r.samples[f].includes.map(sampleLine), "", "excluded (borderline: in the next looser filter):", "", ...r.samples[f].excludes.map(sampleLine), "");
  }
  out.push("## Coverage of the new people (recommended filter)", "", table(["player", "staff"].flatMap((k) => ["profilePage", "birthDate", "country", "residency", "role", "anyGames", "tenGames", "birthCountryRole"].map((m) => {
    const c = r.coverage[k][m];
    return [k, m, `${c.count}/${c.total}`, `${c.pct}%`];
  })), ["kind", "field", "count", "share"]), "");
  out.push("Players without 10 games, by best tier:", "", countTable(r.tierWithoutTenGames), "");
  out.push(`## Probe: ${r.probe.page}`, "", "```json", JSON.stringify(r.probe, null, 2), "```", "");
  return `${out.join("\n")}\n`;
}
