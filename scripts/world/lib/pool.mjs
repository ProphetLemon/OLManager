// The active-pros pool: non-retired people with a Leaguepedia Players page and a roster entry in a league tournament
// of the last three years, added to the overlay as teamless free agents. Pure: lib/pool-fetch.mjs does the queries.
//
// Scope decided for the pool (see scripts/world/README.md, "Adding the active-pros pool"):
//  - the `recommended` tournament filter of lib/pool-scope.mjs;
//  - only people who have a Players page (it is the only source of country, birth date and role);
//  - qualifier-flagged tournaments count only up to `cap` roster entries (open qualifiers hold thousands of names);
//  - nobody the game already has, nobody on a team the roster overlay handles.
import { IdCollisionError, deterministicId, generatePlayer, generateStaff } from "./generate.mjs";
import { foldName, worldBuildChecker } from "./same-person.mjs";
import { pageUrl } from "./leaguepedia-parse.mjs";
import { OPEN_QUALIFIER_ENTRIES, gameStatus, isStaffLabel, qualifierSplit } from "./pool-scope.mjs";
import { GAME_POSITION, POSITION_MIN_GAMES, RATING_STATS, RATING_TIER_DEFAULT, latestMappedCompetition, ratePoolPlayer, shapeBaselines, tierBaselines } from "./pool-rating.mjs";
import { dataRoleForLabel } from "./staff-policy.mjs";
import { compactKey, countryToIso2 } from "./text.mjs";

export const POOL_FILTER = "recommended";
export const DEFAULT_POOL_SINCE = "2023-11-12";
/** A qualifier-flagged tournament with more roster entries than this is an open qualifier and does not count. */
export const DEFAULT_QUALIFIER_CAP = OPEN_QUALIFIER_ENTRIES;
export const DEFAULT_POOL_PROBE = "Send0o";

/** What the pool may grow to. The ops and byte limits are the game's own (olm_core::world_overlay, commands::world_overlay). */
export const POOL_LIMITS = Object.freeze({
  players: 5000,
  staff: 800,
  opsPerList: 5000,
  overlayBytes: 4 * 1024 * 1024,
});

export {
  GAME_POSITION, JUDGMENT_DEFAULT_TIER, RATING_GAME_TIER_DEFAULT, RATING_JUDGMENT_DEFAULT, RATING_LEAGUE_DEFAULT, RATING_STATS, RATING_TIER_DEFAULT, TIER_OFFSETS, tierBaselines,
} from "./pool-rating.mjs";

/** Code-unit order, so ids and lists come out the same on every machine and locale. */
export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `YYYY-MM-DD` when the value is a real calendar date, otherwise null. */
export function isoDate(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
}

/** The birth date the staff generator writes when it has none (generate.mjs `generateStaff`). */
const STAFF_PLACEHOLDER_DOB = "1990-01-01";

/** Stable id of a pool person: the same hash the roster refresh uses for a new person, keyed by the Leaguepedia page. */
export const poolId = (kind, page) => deterministicId(kind === "staff" ? "staff" : "player", page);

/**
 * How two spellings of a page title compare: Unicode-normalised (NFKC), underscores read as spaces like the wiki does,
 * whitespace collapsed and trimmed, case-insensitive. The roster path and the pool path can spell one person's page
 * differently ("Revenge (Yoon Jeong-bin)" and "revenge (Yoon Jeong-bin)"), and the id is a hash of the spelling.
 */
export const titleKey = (title) => String(title ?? "").normalize("NFKC").replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** The country text the game can name: Players.Country, else the primary nationality, else whichever of them is filled. */
const countryOf = (person) => {
  const { country, nationality } = person.profile;
  return [country, nationality].find((value) => countryToIso2(value)) || country || nationality || "";
};

// --- Tournaments ------------------------------------------------------------------------------------

/**
 * Which tournaments of the recommended filter count once qualifiers are capped.
 * @returns {{split: {small: string[], open: string[]}, kept: object[], capped: object[], keptEntries: number, cappedEntries: number}}
 */
export function poolTournaments(tournaments, classes, entryCount, cap = DEFAULT_QUALIFIER_CAP) {
  const split = qualifierSplit(tournaments, classes, entryCount, cap);
  const byPage = new Map(tournaments.map((t) => [t.page, t]));
  const view = (page) => ({ page, name: byPage.get(page)?.name ?? page, league: byPage.get(page)?.league ?? "", entries: entryCount.get(page) ?? 0 });
  const kept = split.small.map(view);
  const capped = split.open.map(view);
  const sum = (list) => list.reduce((total, t) => total + t.entries, 0);
  return { split, kept, capped, keptEntries: sum(kept), cappedEntries: sum(capped) };
}

// --- Selection --------------------------------------------------------------------------------------

/** Keys for the within-pool duplicate check: kind, IGN, real name, country, birth date. */
/** Who a pool page is, whatever its kind: a page read as a player and another read as staff can be one person (AkaRyu, Akaryu). */
function identityKey(person) {
  const profile = person.profile;
  return [compactKey(profile.ign), compactKey(profile.name), countryToIso2(countryOf(person)), isoDate(profile.birthDate) ?? ""].join("|");
}

/**
 * Decide who becomes a pool free agent. Everybody considered gets a status (`selection.statuses`) so the report can say
 * why a named person is or is not in.
 *
 * @param {object} input
 * @param {Map<string, import("./pool-scope.mjs").Person>} input.people merged people of the filter, by Leaguepedia page
 * @param {{playerIndex: unknown, staffIndex: unknown, overrides: unknown, teamKeys: Set<string>}} input.context what the game has
 * @param {import("./world.mjs").World} input.world
 * @param {Set<string>} [input.rosterIds] ids the roster overlay already adds or touches in this run
 * @param {Map<string, {position: string, games: number, last: string}>|null} [input.recentRoles] where each player has played lately
 *   (`recentRolesFromRows`); his role is the one he played most when those games are not older than his latest roster row
 * @param {{player?: Set<string>, staff?: Set<string>}} [input.rosterTitles] page titles of the players and of the staff the
 *   roster overlay adds in this run; a pool person whose page has the same `titleKey` is the same person, whatever id his
 *   spelling hashes to. Kinds do not stay apart: a head coach the roster overlay adds is not also a pool player, and a player
 *   it adds is not also a pool coach (one person, one record).
 * @param {Map<string, number>|null} [input.gamesLastYear] games each player has in the stats rows in the year before the run's as-of date;
 *   with it, a person whose Players page lists a staff role and who has fewer than `POSITION_MIN_GAMES` of them is pooled as staff
 * @param {{player?: object[], staff?: object[]}|null} [input.rosterRecords] the player and staff records the roster overlay adds in
 *   this run; a pool player whose own Players page makes him staff is the coach it adds undated with his real name and country.
 */
export function selectPool({ people, context, world, rosterIds = new Set(), rosterTitles = {}, rosterRecords = null, recentRoles = null, gamesLastYear = null }) {
  // Real name and country of the staff the roster overlay of this run adds without a birth date (the generator's 1990-01-01).
  const undatedRosterStaff = new Set(
    (rosterRecords?.staff ?? [])
      .filter((staff) => !staff.date_of_birth || staff.date_of_birth === STAFF_PLACEHOLDER_DOB)
      .map((staff) => `${foldName(staff.first_name)}|${countryToIso2(staff.nationality)}`),
  );
  const rosterKeys = { player: new Set([...(rosterTitles.player ?? [])].map(titleKey)), staff: new Set([...(rosterTitles.staff ?? [])].map(titleKey)) };
  const counts = { considered: 0, noPage: 0, inGame: 0, onGameTeam: 0, handledByRoster: 0, uncertain: 0, nonSportingStaff: 0, noPosition: 0, duplicates: 0, collisions: 0, sameAsGameRecord: 0 };
  const statuses = new Map();
  const refused = [];
  const collisions = [];
  const accepted = [];
  const owner = { player: new Map(world.players.map((p) => [p.id, p.id])), staff: new Map(world.staff.map((s) => [s.id, s.id])) };

  const refuse = (person, code, reason, countKey) => {
    counts[countKey] += 1;
    refused.push({ page: person.page, kind: person.kind, code, reason });
    statuses.set(person.page, { state: "refused", code, reason });
  };

  for (const listed of [...people.values()].sort((a, b) => compare(a.page, b.page))) {
    // Owner's decision (2026-11-24): the Players page role says what a person is today, so a listed staff role beats playing roster rows unless he still plays.
    const staffByProfile = gamesLastYear && listed.kind !== "staff" && isStaffLabel(listed.profile.role) && (gamesLastYear.get(listed.page) ?? 0) < POSITION_MIN_GAMES;
    const person = staffByProfile ? { ...listed, kind: "staff", position: null, staffLabel: String(listed.profile.role).trim() } : listed;
    counts.considered += 1;
    if (!person.profile.ign) {
      counts.noPage += 1;
      statuses.set(person.page, { state: "excluded", code: "no-players-page", reason: "no Leaguepedia Players page (no country, birth date or role source)" });
      continue;
    }
    const game = gameStatus(person, context);
    if (game.status === "in-game") {
      counts.inGame += 1;
      statuses.set(person.page, { state: "excluded", code: "in-game", reason: `already in the game as ${game.id}`, id: game.id });
      continue;
    }
    const id = poolId(person.kind, person.page);
    const other = person.kind === "staff" ? "player" : "staff";
    // The game may hold him in the other role: a coach of the bundled world is not also a free agent player, and the reverse.
    const asOther = gameStatus({ ...person, kind: other }, context);
    if (asOther.status === "in-game") {
      counts.inGame += 1;
      statuses.set(person.page, { state: "excluded", code: "in-game", reason: `already in the game ${other === "staff" ? "as staff" : "as a player"}: ${asOther.id}`, id: asOther.id });
      continue;
    }
    const sameTitle = rosterKeys[person.kind === "staff" ? "staff" : "player"].has(titleKey(person.page));
    // The other kind too: a coach the roster overlay adds to a staff table is that person, not a free agent player as well.
    const otherRole = rosterIds.has(poolId(other, person.page)) || rosterKeys[other].has(titleKey(person.page));
    // A player whose own Players page makes him staff, when the roster overlay adds an undated staff member with his real name
    // and country: the same coach under another page (Nulu and Selfie, Marcin Wolski, PL, both on Shopify Rebellion's staff).
    const coachElsewhere = listed.kind !== "staff" && isStaffLabel(person.profile.role) && String(person.profile.name ?? "").trim().split(/\s+/).length >= 2
      && undatedRosterStaff.has(`${foldName(person.profile.name)}|${countryToIso2(countryOf(person))}`);
    const handledByOverlay = rosterIds.has(id) || sameTitle || otherRole || coachElsewhere;
    // A current team the game has excludes a person only when the roster overlay of this run really handles him. A player
    // whose Players page names a game team but who is on none of its playing rosters (a co-streamer, say) is nobody's
    // business but the pool's, so he falls through to the same checks as any other candidate.
    if (game.status === "on-game-team" && handledByOverlay) {
      counts.onGameTeam += 1;
      statuses.set(person.page, { state: "excluded", code: "on-game-team", reason: "his current team is a team the game has and the roster overlay of this run handles him", id });
      continue;
    }
    // `unconfirmed` is the matcher's doubt about a person on a game team: not handled by the overlay, still maybe in the game.
    const doubt = game.status === "uncertain" ? game.reason : game.status === "on-game-team" ? game.unconfirmed : undefined;
    if (game.status === "uncertain" || (game.status === "on-game-team" && "unconfirmed" in game)) {
      refuse(person, "ambiguous-with-game", `possible match with a game record, needs a human (pin it in id-map.json): ${doubt ?? "unconfirmed match"}`, "uncertain");
      continue;
    }
    if (handledByOverlay) {
      counts.handledByRoster += 1;
      const why = rosterIds.has(id) ? `already adds or moves ${id}`
        : sameTitle ? `already adds the page "${person.page}" under another spelling`
        : otherRole ? `already handles the page "${person.page}" ${other === "staff" ? "as staff" : "as a player"}`
        : `already adds a staff member with his real name and country, and his Players page makes him staff (${person.profile.role})`;
      statuses.set(person.page, { state: "excluded", code: "roster-overlay", reason: `the roster overlay of this run ${why}`, id });
      continue;
    }
    let role;
    let step = null;
    if (person.kind === "staff") {
      role = dataRoleForLabel(person.staffLabel);
      if (!role) {
        refuse(person, "non-sporting-staff", `staff label "${person.staffLabel}" is not a game staff role (the game takes coaches, analysts and scouts)`, "nonSportingStaff");
        continue;
      }
    } else {
      // Position evidence, best first: (a) his own recent games, when he has enough of them and the roster has no newer word; then
      // what the roster and the Players page say (describePerson: b, c, d, first).
      const recent = recentRoles?.get(person.page);
      const byGames = recent && recent.games >= POSITION_MIN_GAMES && recent.last >= (person.lastStart ?? "") && GAME_POSITION[recent.position] ? recent : null;
      step = byGames ? "a" : person.positionStep;
      role = GAME_POSITION[byGames ? byGames.position : person.position] ?? null;
      if (!role) {
        refuse(person, "no-position", `no usable position (roster roles ${JSON.stringify(person.roles)}, profile role "${person.profile.role}")`, "noPosition");
        continue;
      }
    }
    accepted.push({ page: person.page, kind: person.kind, id, role, step, person });
  }

  // Two pages that read as the same person are ambiguous: neither is added.
  const groups = new Map();
  for (const entry of accepted) {
    const key = identityKey(entry.person);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const duplicates = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      duplicates.add(entry);
      refuse(entry.person, "duplicate-in-pool", `same IGN, name, country and birth date as ${group.filter((e) => e !== entry).map((e) => `${e.page}${e.kind === entry.kind ? "" : ` (${e.kind})`}`).join(", ")}`, "duplicates");
    }
  }

  // Ids come from an 8-hex hash, so two pages (or a page and a game id) can in principle collide. First page in code-unit order keeps the id.
  const kept = [];
  for (const entry of accepted) {
    if (duplicates.has(entry)) continue;
    const taken = owner[entry.kind === "staff" ? "staff" : "player"];
    if (taken.has(entry.id)) {
      const other = taken.get(entry.id);
      collisions.push({ page: entry.page, kind: entry.kind, id: entry.id, with: other });
      refuse(entry.person, "id-collision", `id ${entry.id} is already used by ${other}`, "collisions");
      continue;
    }
    taken.set(entry.id, entry.page);
    statuses.set(entry.page, { state: "added", id: entry.id });
    kept.push(entry);
  }

  return {
    players: kept.filter((e) => e.kind === "player"),
    staff: kept.filter((e) => e.kind === "staff"),
    counts,
    refused,
    collisions,
    statuses,
  };
}

// --- Operations --------------------------------------------------------------------------------------

/** What the review report and later runs read about a pool person, carried on the op next to the game's own fields. */
function poolMeta(entry, { tournamentIndex, games, rating }) {
  const person = entry.person;
  const levels = {};
  const leagues = new Set();
  for (const page of person.tournaments ?? []) {
    const tournament = tournamentIndex?.get(page);
    const level = tournament?.level || "(none)";
    levels[level] = (levels[level] ?? 0) + 1;
    if (tournament?.league) leagues.add(tournament.league);
  }
  const meta = {
    page: person.page,
    kind: person.kind,
    role: person.kind === "staff" ? person.staffLabel : person.position,
    region: person.region,
    country: countryOf(person) || null,
    birth_date: isoDate(person.profile.birthDate),
    tier: person.tier,
    best_level: person.bestLevel ?? null,
    entries: person.entries,
    last_start: person.lastStart || null,
    games: games ? (games.get(person.page) ?? 0) : null,
    tournaments: (person.tournaments ?? []).length || null,
    leagues: [...leagues].sort(compare),
    levels: Object.fromEntries(Object.entries(levels).sort(([a], [b]) => compare(a, b))),
  };
  if (person.toursTruncated) meta.tournaments_truncated = true;
  meta.rating = rating.source;
  if (rating.source === RATING_STATS) meta.rating_games = rating.games;
  // The league whose level or default the rating used (anchored ratings only); review data, like the rest of `pool`.
  if (rating.competition) meta.rating_competition = rating.competition;
  return meta;
}

/**
 * Teamless `add` operations for the selected people.
 * @param {object} input
 * @param {ReturnType<typeof selectPool>} input.selection
 * @param {Map<string, object>} [input.tournamentIndex] tournaments by page, for the level and league summary
 * @param {Map<string, number>|null} [input.games] scoreboard games per player page in the window, or null when unavailable
 * @param {Map<string, import("../../stats/lib/skill.mjs").SkillEstimate>|null} [input.skill] usable skill estimate per player page
 *   (see pool-rating.mjs); a player with one that has enough games is rated from stats, everybody else gets the tier default
 * @param {ReturnType<import("./generate.mjs").computeBaselines>} input.baselines
 * @param {object|null} [input.anchors] the game's league levels and defaults (pool-anchors.mjs). With them a stats rating sits on the level
 *   of the league his stats come from and a player without an estimate takes the default of the league he last played in (or the
 *   judgment default); without them everybody is anchored to the tier baseline, as before.
 */
export function buildPoolOps({ selection, tournamentIndex, games = null, skill = null, baselines, anchors = null }) {
  const players = [];
  const staff = [];
  const skipped = [];
  for (const entry of [...selection.players, ...selection.staff]) {
    const { person } = entry;
    const profile = person.profile;
    const birth = isoDate(profile.birthDate);
    const country = countryOf(person);
    // Staff have no stats and no league: the tier default, as always. A player's shape comes from the league he last played in when the run has anchors.
    const competition = anchors && entry.kind === "player" ? latestMappedCompetition({ tournaments: person.tournaments ?? [], tournamentIndex, anchors }) : null;
    const rated = entry.kind === "player" ? shapeBaselines({ baselines, tier: person.tier, anchors, competition }) : tierBaselines(baselines, person.tier);
    try {
      if (entry.kind === "player") {
        const { record, dobApprox, nationalityMissing } = generatePlayer({
          page: person.page, ign: profile.ign, realName: profile.name, country, position: entry.role, teamId: null, competition: null,
          infobox: { birthDate: birth, name: profile.name, country }, baselines: rated, takenIds: new Set(),
        });
        // Stats replace the seeded jitter: the jitter only keeps clones of one baseline apart. An anchored default keeps the jittered
        // record as its shape (so a league's players are not clones) and lands on the league's default OVR.
        const rating = ratePoolPlayer({
          tier: person.tier, position: entry.role, baselines, estimate: skill?.get(person.page) ?? null, anchors, competition,
          seed: { attributes: record.attributes, potential: record.potential_base },
        });
        if (rating.source !== RATING_TIER_DEFAULT) {
          record.attributes = rating.attributes;
          record.potential_base = rating.potential;
        }
        const op = { op: "add", player: record, evidence: pageUrl(person.page) };
        if (dobApprox) op.dob_approx = true;
        op.pool = poolMeta(entry, { tournamentIndex, games, rating });
        players.push({ op, id: record.id, teamId: null, competition: null, note: `${profile.ign} (${record.full_name}) free agent ${entry.role}, tier ${person.tier}, ${person.region}${nationalityMissing ? "; nationality unresolved" : ""}` });
      } else {
        const { record, nationalityMissing } = generateStaff({
          canonicalTitle: person.page, ign: profile.ign, realName: profile.name, country, role: entry.role, teamId: null, baselines: rated, takenIds: new Set(),
        });
        const op = { op: "add", staff: record, evidence: pageUrl(person.page) };
        if (birth) record.date_of_birth = birth;
        else op.dob_approx = true;
        op.pool = poolMeta(entry, { tournamentIndex, games, rating: { source: RATING_TIER_DEFAULT } });
        staff.push({ op, id: record.id, teamId: null, competition: null, note: `${profile.ign} (${record.first_name}) free agent ${entry.role} (${person.staffLabel}), tier ${person.tier}, ${person.region}${nationalityMissing ? "; nationality unresolved" : ""}` });
      }
    } catch (error) {
      if (!(error instanceof IdCollisionError)) throw error;
      skipped.push({ kind: "add-failed", subject: person.page, detail: error.message });
    }
  }
  return { players, staff, skipped };
}

/**
 * Leave out the pool players the world build would fold into a record on a club (K2) or hide from the AI signing guard: they are
 * a person the game already has under another record, and nobody would ever see them. The rules are the game's own (same-person.mjs).
 * Mutates `selection` so the report says why each of them is out, and returns the ops without them.
 * @param {object} input
 * @param {ReturnType<typeof selectPool>} input.selection
 * @param {ReturnType<typeof buildPoolOps>} input.ops
 * @param {object[]} input.contracted the players on a club once the roster overlay is applied (`contractedPlayers`)
 */
export function dropWorldBuildTwins({ selection, ops, contracted }) {
  const players = [];
  const dropped = new Set();
  const foldedBy = worldBuildChecker(contracted, ops.players.map((entry) => entry.op.player));
  for (const entry of ops.players) {
    const hit = foldedBy(entry.op.player);
    if (!hit) {
      players.push(entry);
      continue;
    }
    const page = entry.op.pool.page;
    const reason = `the world build would fold or hide him as the same person as ${hit.with} (${hit.rule}), so the game would show one record`;
    dropped.add(entry.id);
    selection.counts.sameAsGameRecord += 1;
    selection.refused.push({ page, kind: "player", code: "same-person-as-game-record", reason });
    selection.statuses.set(page, { state: "refused", code: "same-person-as-game-record", reason });
  }
  selection.players = selection.players.filter((entry) => !dropped.has(entry.id));
  return { ...ops, players };
}

/** How many of the selected players took each step of the position evidence (see `choosePosition` in pool-scope.mjs; "a" is his own recent games). */
export function positionSteps(selection) {
  const steps = { a: 0, b: 0, c: 0, d: 0, first: 0, profile: 0 };
  for (const entry of selection.players) if (entry.step in steps) steps[entry.step] += 1;
  return steps;
}
