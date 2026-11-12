// Pure parts of the active-pros pool measurement: which Leaguepedia tournaments count as league play,
// how people are grouped, and how many the game already has. No I/O; scripts/world/pool-scope.mjs does the queries.
import { matchPerson } from "./match.mjs";
import { compactKey, countryToIso2 } from "./text.mjs";
import { dataRoleForLabel } from "./staff-policy.mjs";

export const FILTERS = Object.freeze(["strict", "recommended", "loose"]);
/** A league needs this many tournaments in the window to count as a recurring competition rather than a one-off event. */
export const MIN_LEAGUE_TOURNAMENTS = 3;
/** A tournament this long (days) is a season, not a weekend cup. */
export const SEASON_DAYS = 14;

const text = (value) => String(value ?? "").trim();
const flag = (value) => text(value) === "1";

/** Normalise a Cargo row of `Tournaments` joined to `Leagues` (field names as the query aliases them). */
export function normalizeTournament(row) {
  return {
    page: text(row.OverviewPage),
    name: text(row.Name),
    league: text(row.League),
    region: text(row.Region),
    level: text(row.TournamentLevel),
    official: flag(row.IsOfficial),
    qualifier: flag(row.IsQualifier),
    playoffs: flag(row.IsPlayoffs),
    split: text(row.Split),
    year: text(row.Year),
    start: text(row.DateStart),
    end: text(row.Date),
    leagueLevel: text(row.LLevel),
    leagueOfficial: text(row.LOfficial) === "Yes",
  };
}

export function tournamentDays(tournament) {
  const start = Date.parse(tournament.start);
  const end = Date.parse(tournament.end);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 86_400_000) : 0;
}

const isShowmatch = (t) => /show\s*match/i.test(t.level);
/** Cup qualifiers and showmatches never count, whatever else the page says. */
const isBase = (t) => !isShowmatch(t) && t.level !== "Qualifier";
const isOfficialCircuit = (t) => t.official || (t.leagueOfficial && (t.leagueLevel === "Primary" || t.leagueLevel === "Secondary"));

/** Leagues (by `Tournaments.League`) that run in several seasons or splits and at least one real season length. */
export function seasonalLeagues(tournaments) {
  const byLeague = new Map();
  for (const t of tournaments) {
    if (!t.league) continue;
    if (!byLeague.has(t.league)) byLeague.set(t.league, []);
    byLeague.get(t.league).push(t);
  }
  const seasonal = new Set();
  for (const [league, list] of byLeague) {
    const splits = new Set(list.filter((t) => t.split).map((t) => `${t.year}/${t.split}`));
    if (splits.size >= 2 && list.some((t) => tournamentDays(t) >= SEASON_DAYS)) seasonal.add(league);
  }
  return seasonal;
}

export function leagueCounts(tournaments) {
  const counts = new Map();
  for (const t of tournaments) if (t.league) counts.set(t.league, (counts.get(t.league) ?? 0) + 1);
  return counts;
}

/**
 * @param {ReturnType<typeof normalizeTournament>[]} tournaments every tournament in the window
 * @returns {Map<string, {strict:boolean, recommended:boolean, loose:boolean}>} by tournament page
 *
 * Nested filters, all of them also expressible as Cargo `where` clauses (see `cargoClasses`):
 *  - strict: official circuit (flagged on the tournament, or its league is an official Primary/Secondary league) in a recurring league;
 *  - recommended: strict plus the non-qualifier tournaments of recurring seasonal leagues (second divisions Leaguepedia does not flag);
 *  - loose: every non-qualifier tournament of a recurring league.
 * Showmatches and cup-qualifier level tournaments never count; a league is recurring from three tournaments in the window.
 */
export function classifyTournaments(tournaments) {
  const seasonal = seasonalLeagues(tournaments);
  const counts = leagueCounts(tournaments);
  const result = new Map();
  for (const t of tournaments) {
    const base = isBase(t) && (counts.get(t.league) ?? 0) >= MIN_LEAGUE_TOURNAMENTS;
    const official = isOfficialCircuit(t);
    const strict = base && official;
    const recommended = base && (official || (seasonal.has(t.league) && !t.qualifier));
    const loose = base && (official || !t.qualifier);
    result.set(t.page, { strict, recommended, loose });
  }
  return result;
}

const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** Longest league list one request carries; Leaguepedia answers HTTP 400 for URLs near 8 KB. */
export const MAX_LIST_CHARS = 2400;

/** Split names into lists whose quoted length stays under MAX_LIST_CHARS, in sorted order. */
export function chunkNames(leagues) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const league of [...leagues].sort()) {
    const length = quote(league).length + 1;
    if (current.length > 0 && size + length > MAX_LIST_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(league);
    size += length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const OFFICIAL = '(T.IsOfficial="1" OR (L.IsOfficial="Yes" AND L.Level IN ("Primary","Secondary")))';
const NOT_OFFICIAL = '(T.IsOfficial IS NULL OR T.IsOfficial="0") AND (L.IsOfficial IS NULL OR L.IsOfficial<>"Yes" OR L.Level IS NULL OR L.Level NOT IN ("Primary","Secondary"))';
const NOT_QUALIFIER = '(T.IsQualifier IS NULL OR T.IsQualifier="0")';
/** Cargo clause (Tournaments=T) for tournaments Leaguepedia does not flag as qualifiers. */
export const NOT_QUALIFIER_CLAUSE = NOT_QUALIFIER;

/**
 * Cargo `where` clauses (on Tournaments=T, Leagues=L) that cut the loose filter into three disjoint classes:
 * `official` (= strict), `seasonal` (unflagged tournaments of seasonal leagues; strict + seasonal = recommended) and
 * `other` (the rest of loose). Each class is a list of clauses because league lists are chunked to keep URLs short.
 * Their tournament counts add up to the local predicate's counts.
 */
export function cargoClasses(tournaments, since) {
  const classes = classifyTournaments(tournaments);
  const leaguesWhere = (pick) => new Set(tournaments.filter((t) => t.league && pick(classes.get(t.page))).map((t) => t.league));
  const official = leaguesWhere((c) => c.strict);
  const seasonal = seasonalLeagues(tournaments);
  const other = leaguesWhere((c) => c.loose && !c.recommended);
  const base = `T.DateStart >= ${quote(since)} AND (T.TournamentLevel IS NULL OR T.TournamentLevel NOT IN ("Showmatch","Show Match","Qualifier"))`;
  const clauses = (leagues, rest) => chunkNames(leagues).map((chunk) => `${base} AND T.League IN (${chunk.map(quote).join(",")}) AND ${rest}`);
  return {
    official: clauses(official, OFFICIAL),
    seasonal: clauses(seasonal, `${NOT_QUALIFIER} AND ${NOT_OFFICIAL}`),
    other: clauses(other, `${NOT_QUALIFIER} AND ${NOT_OFFICIAL}`),
  };
}

/** A qualifier-flagged tournament with more roster entries than this is an open qualifier, not a promotion or closed stage. */
export const OPEN_QUALIFIER_ENTRIES = 60;

/**
 * Split the qualifier-flagged tournaments of the strict filter by roster size.
 * @param {Map<string, number>} entryCount roster entries per tournament page
 * @param {number} [threshold] largest roster a qualifier-flagged tournament may have to count as small
 */
export function qualifierSplit(tournaments, classes, entryCount, threshold = OPEN_QUALIFIER_ENTRIES) {
  const small = [];
  const open = [];
  for (const t of tournaments) {
    if (!classes.get(t.page)?.strict || !t.qualifier) continue;
    ((entryCount.get(t.page) ?? 0) <= threshold ? small : open).push(t.page);
  }
  return { small: small.sort(), open: open.sort() };
}

/** Cargo `where` clauses (Tournaments=T) selecting the given tournament pages, chunked like the league lists. */
export function pageClauses(pages) {
  return chunkNames(pages).map((chunk) => `T.OverviewPage IN (${chunk.map(quote).join(",")})`);
}

/** Which filters a Cargo class belongs to. */
export const CLASS_FILTERS = Object.freeze({ official: ["strict", "recommended", "loose"], seasonal: ["recommended", "loose"], other: ["loose"] });

// --- People ---------------------------------------------------------------------------------------

const POSITIONS = new Map([
  ["top", "Top"], ["top laner", "Top"], ["jungle", "Jungle"], ["jungler", "Jungle"], ["jng", "Jungle"],
  ["mid", "Mid"], ["middle", "Mid"], ["mid laner", "Mid"],
  ["bot", "Bot"], ["adc", "Bot"], ["bot laner", "Bot"], ["bottom", "Bot"],
  ["support", "Support"], ["sup", "Support"],
]);

/** One of Top/Jungle/Mid/Bot/Support for a Leaguepedia role label, or null (also for the first of "Top, Mid"). */
export function playerPosition(label) {
  const first = text(label).toLowerCase().split(/[,/;]/)[0].trim();
  return POSITIONS.get(first) ?? null;
}

const STAFF_LABEL = /coach|analyst|manager|scout|director|strategist|owner|staff|trainer|psycholog|mentor/i;
/** True for a label that names staff rather than a playing position. */
export function isStaffLabel(label) {
  const raw = text(label);
  return !playerPosition(raw) && STAFF_LABEL.test(raw);
}

/** Every label in a roster role value, which Leaguepedia may join with commas ("Top,Jungle,Mid"). */
export const roleLabels = (value) => text(value).split(/[,;]/).map((x) => x.trim()).filter(Boolean);

/**
 * Player or staff, and the position or staff label. `roles` are the roster role values the person has in the filter;
 * `profileRole` is `Players.Role`, used when the roster values name nothing. A person who ever held a playing position
 * is a player; otherwise one who held only staff labels is staff.
 */
export function describePerson(roles, profileRole) {
  const labels = roles.flatMap(roleLabels);
  const position = labels.map(playerPosition).find(Boolean) ?? null;
  const staffLabel = labels.find(isStaffLabel) ?? null;
  if (position) return { kind: "player", position, staffLabel: null };
  if (staffLabel) return { kind: "staff", position: null, staffLabel };
  const fromProfile = playerPosition(profileRole);
  if (fromProfile) return { kind: "player", position: fromProfile, staffLabel: null };
  if (isStaffLabel(profileRole)) return { kind: "staff", position: null, staffLabel: text(profileRole) };
  return { kind: "player", position: null, staffLabel: null };
}

/**
 * Rating-default tier from aggregates over a person's tournaments: 1 top flight, 2 official circuit,
 * 3 recurring seasonal league (unflagged second divisions and amateur circuits).
 */
export function tierFromAggregates({ leagueLevelMin, tournamentLevelMin, tournamentOfficial, leagueOfficial }) {
  if (leagueLevelMin === "Primary" || tournamentLevelMin === "Primary") return 1;
  if (tournamentOfficial === "1" || leagueOfficial === "Yes") return 2;
  return 3;
}

/** Tournament levels from best to worst; anything else ranks after them. */
export const LEVEL_ORDER = Object.freeze(["Primary", "Secondary", "Minor", "Tertiary"]);
const levelRank = (level) => (LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length);

/** The better of two tournament level labels; empty labels lose to any label, and null means neither is known. */
export function bestLevel(...levels) {
  const known = levels.map(text).filter(Boolean);
  return known.length === 0 ? null : known.reduce((best, level) => (levelRank(level) < levelRank(best) ? level : best));
}

/** `GROUP_CONCAT` joins the tournament pages with this separator (a character no wiki page title can contain). */
export const TOURS_SEPARATOR = "|";
/** MySQL's default `group_concat_max_len` is 1024; a list this long may have lost its tail. */
export const TOURS_MAX_CHARS = 1000;

/** The tournament pages of a `tours` value, and whether the list may have been cut at the server's length limit. */
export function parseTournaments(value) {
  const raw = text(value);
  if (!raw) return { tournaments: [], truncated: false };
  const truncated = raw.length >= TOURS_MAX_CHARS;
  const list = raw.split(TOURS_SEPARATOR).map((x) => x.trim()).filter(Boolean);
  if (truncated) list.pop();
  return { tournaments: [...new Set(list)].sort(), truncated };
}

/** A person from one aggregated Cargo row (one row per person; see pool-scope.mjs for the query). */
export function personFromRow(row) {
  const profile = {
    ign: text(row.ign), name: text(row.name), country: text(row.country), nationality: text(row.nat), birthDate: text(row.birth),
    residency: text(row.res), role: text(row.prole), team: text(row.team), currentTeams: "",
  };
  const roles = [row.rmin, row.rmax].map(text).filter(Boolean);
  const { tournaments, truncated } = parseTournaments(row.tours);
  return {
    page: text(row.player),
    profile,
    roles,
    ...describePerson(roles, profile.role),
    tier: tierFromAggregates({
      leagueLevelMin: text(row.lmin), tournamentLevelMin: text(row.tmin), tournamentOfficial: text(row.toff), leagueOfficial: text(row.loff),
    }),
    region: profile.residency || text(row.region) || "(none)",
    bestLevel: bestLevel(row.lmin, row.tmin),
    lastStart: text(row.last),
    entries: Number(row.n) || 0,
    tournaments,
    toursTruncated: truncated,
  };
}

/** Merge the rows one person gets from several Cargo classes or chunks. */
export function mergePerson(a, b) {
  const profileRole = a.profile.role || b.profile.role;
  const roles = [...new Set([...a.roles, ...b.roles])];
  return {
    ...a,
    roles,
    ...describePerson(roles, profileRole),
    tier: Math.min(a.tier, b.tier),
    bestLevel: bestLevel(a.bestLevel, b.bestLevel),
    lastStart: a.lastStart > b.lastStart ? a.lastStart : b.lastStart,
    entries: a.entries + b.entries,
    tournaments: [...new Set([...(a.tournaments ?? []), ...(b.tournaments ?? [])])].sort(),
    toursTruncated: Boolean(a.toursTruncated || b.toursTruncated),
  };
}

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const sorted = (map) => Object.fromEntries([...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));

/** Counts over people; `exclude(person)` drops people before counting. */
export function summarizePeople(people, { exclude = () => false } = {}) {
  const byPosition = new Map();
  const byStaffLabel = new Map();
  const byRegion = { player: new Map(), staff: new Map() };
  const byTier = new Map();
  let players = 0;
  let staff = 0;
  for (const person of people) {
    if (exclude(person)) continue;
    const isStaff = person.kind === "staff";
    if (isStaff) staff += 1;
    else players += 1;
    if (isStaff) bump(byStaffLabel, person.staffLabel ?? "(none)");
    else bump(byPosition, person.position ?? "(none)");
    bump(byRegion[isStaff ? "staff" : "player"], person.region || "(none)");
    bump(byTier, `tier ${person.tier}`);
  }
  return {
    people: players + staff, players, staff, byPosition: sorted(byPosition), byStaffLabel: sorted(byStaffLabel),
    byRegion: { player: sorted(byRegion.player), staff: sorted(byRegion.staff) }, byTier: sorted(byTier),
  };
}

/** Evenly spaced picks, so the same input always gives the same sample. */
export function evenSample(list, count) {
  if (list.length <= count) return [...list];
  return Array.from({ length: count }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / count)]);
}

/** Share of `items` for which `test(item)` holds, as `{count, total, pct}`. */
export function share(items, test) {
  const list = [...items];
  const count = list.filter(test).length;
  return { count, total: list.length, pct: list.length === 0 ? 0 : Math.round((count / list.length) * 1000) / 10 };
}

// --- Subtracting what the game has ----------------------------------------------------------------

/** Compact keys of the Leaguepedia page titles of the teams the game has (team-map.json entries with a title). */
export function gameTeamKeys(teamMap) {
  return new Set(Object.values(teamMap?.teams ?? {}).map((entry) => compactKey(entry?.title)).filter(Boolean));
}

/**
 * Is this person already in the game?
 * `in-game`: matched to a game player or staff id. `on-game-team`: not matched, but his current team is one the game
 * has, so the roster overlay handles him. `uncertain`: a weak or ambiguous match that needs a human. `new`: neither.
 */
export function gameStatus(person, { playerIndex, staffIndex, overrides, teamKeys }) {
  const profile = person.profile;
  const kind = person.kind === "staff" ? "staff" : "player";
  const result = matchPerson(
    { ign: profile.ign || person.page, page: person.page, realName: profile.name, country: profile.country || profile.nationality || null, birthDate: profile.birthDate || null },
    kind === "staff" ? staffIndex : playerIndex,
    { kind, overrides },
  );
  if (result.status === "matched") return { status: "in-game", id: result.entity.id };
  const teams = [profile.team, ...String(profile.currentTeams ?? "").split(",")].map(compactKey).filter(Boolean);
  if (teams.some((team) => teamKeys.has(team))) return { status: "on-game-team" };
  if (result.status === "review" || result.status === "ambiguous") return { status: "uncertain", reason: result.reason };
  return { status: "new" };
}

// --- Field coverage -------------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Which of the fields the game needs does this person have? `games` is the number of scoreboard rows in the window. */
export function fieldCoverage(person, games) {
  const profile = person.profile;
  const country = profile.country || profile.nationality || "";
  return {
    profilePage: Boolean(profile.ign),
    birthDate: ISO_DATE.test(profile.birthDate ?? ""),
    country: Boolean(countryToIso2(country)),
    residency: Boolean(profile.residency),
    role: person.kind === "staff" ? Boolean(dataRoleForLabel(person.staffLabel)) : Boolean(person.position),
    anyGames: games >= 1,
    tenGames: games >= 10,
  };
}
