// The active-pros pool: non-retired people with a Leaguepedia Players page and a roster entry in a league tournament
// of the last three years, added to the overlay as teamless free agents. Pure: lib/pool-fetch.mjs does the queries.
//
// Scope decided for the pool (see scripts/world/README.md, "Adding the active-pros pool"):
//  - the `recommended` tournament filter of lib/pool-scope.mjs;
//  - only people who have a Players page (it is the only source of country, birth date and role);
//  - qualifier-flagged tournaments count only up to `cap` roster entries (open qualifiers hold thousands of names);
//  - nobody the game already has, nobody on a team the roster overlay handles.
import { IdCollisionError, deterministicId, generatePlayer, generateStaff } from "./generate.mjs";
import { pageUrl } from "./leaguepedia-parse.mjs";
import { OPEN_QUALIFIER_ENTRIES, gameStatus, qualifierSplit } from "./pool-scope.mjs";
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

/** Marks attributes that are a stand-in until A4 rates the person from stats. Carried on every pool op as `pool.rating`. */
export const PLACEHOLDER_RATING = "tier-default-placeholder";
/**
 * Placeholder rating: the game's median for the position, shifted by the tier of the person's best competition
 * (1 top flight, 2 official circuit, 3 recurring seasonal league). Replaced by the stats-based rating of A4.
 */
export const TIER_OFFSETS = Object.freeze({ 1: 0, 2: -6, 3: -12 });

/** The position names the game's overlay uses; Leaguepedia says "Bot" where the game says "ADC". */
export const GAME_POSITION = Object.freeze({ Top: "Top", Jungle: "Jungle", Mid: "Mid", Bot: "ADC", Support: "Support" });

/** Code-unit order, so ids and lists come out the same on every machine and locale. */
export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** `YYYY-MM-DD` when the value is a real calendar date, otherwise null. */
export function isoDate(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
}

/** Stable id of a pool person: the same hash the roster refresh uses for a new person, keyed by the Leaguepedia page. */
export const poolId = (kind, page) => deterministicId(kind === "staff" ? "staff" : "player", page);

const countryOf = (person) => person.profile.country || person.profile.nationality || "";

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
function identityKey(person) {
  const profile = person.profile;
  return [person.kind, compactKey(profile.ign), compactKey(profile.name), countryToIso2(countryOf(person)), isoDate(profile.birthDate) ?? ""].join("|");
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
 */
export function selectPool({ people, context, world, rosterIds = new Set() }) {
  const counts = { considered: 0, noPage: 0, inGame: 0, onGameTeam: 0, handledByRoster: 0, uncertain: 0, nonSportingStaff: 0, noPosition: 0, duplicates: 0, collisions: 0 };
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

  for (const person of [...people.values()].sort((a, b) => compare(a.page, b.page))) {
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
    if (game.status === "on-game-team") {
      counts.onGameTeam += 1;
      statuses.set(person.page, { state: "excluded", code: "on-game-team", reason: "his current team is a team the game has; the roster overlay handles him" });
      continue;
    }
    if (game.status === "uncertain") {
      refuse(person, "ambiguous-with-game", `possible match with a game record, needs a human (pin it in id-map.json): ${game.reason ?? "unconfirmed match"}`, "uncertain");
      continue;
    }
    const id = poolId(person.kind, person.page);
    if (rosterIds.has(id)) {
      counts.handledByRoster += 1;
      statuses.set(person.page, { state: "excluded", code: "roster-overlay", reason: `the roster overlay of this run already adds or moves ${id}`, id });
      continue;
    }
    let role;
    if (person.kind === "staff") {
      role = dataRoleForLabel(person.staffLabel);
      if (!role) {
        refuse(person, "non-sporting-staff", `staff label "${person.staffLabel}" is not a game staff role (the game takes coaches, analysts and scouts)`, "nonSportingStaff");
        continue;
      }
    } else {
      role = GAME_POSITION[person.position] ?? null;
      if (!role) {
        refuse(person, "no-position", `no usable position (roster roles ${JSON.stringify(person.roles)}, profile role "${person.profile.role}")`, "noPosition");
        continue;
      }
    }
    accepted.push({ page: person.page, kind: person.kind, id, role, person });
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
      refuse(entry.person, "duplicate-in-pool", `same kind, IGN, name, country and birth date as ${group.filter((e) => e !== entry).map((e) => e.page).join(", ")}`, "duplicates");
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

// --- Placeholder ratings -----------------------------------------------------------------------------

function shift(values, delta, range) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, clamp(value + delta, range?.[key]?.min ?? 1, range?.[key]?.max ?? 100)]));
}

/** Baselines shifted by the tier offset: the tier-default placeholder rating (see TIER_OFFSETS). */
export function tierBaselines(baselines, tier) {
  const delta = TIER_OFFSETS[tier] ?? TIER_OFFSETS[3];
  return {
    player(competition, position) {
      const base = baselines.player(competition, position);
      return { ...base, attributes: shift(base.attributes, delta, base.range), potential: clamp(base.potential + delta, 1, 100) };
    },
    staff(role) {
      const base = baselines.staff(role);
      return { ...base, attributes: shift(base.attributes, delta, base.range) };
    },
  };
}

// --- Operations --------------------------------------------------------------------------------------

/** What A4 needs to rate a pool person later, carried on the op next to the game's own fields. */
function poolMeta(entry, { tournamentIndex, games }) {
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
  meta.rating = PLACEHOLDER_RATING;
  return meta;
}

/**
 * Teamless `add` operations for the selected people.
 * @param {object} input
 * @param {ReturnType<typeof selectPool>} input.selection
 * @param {Map<string, object>} [input.tournamentIndex] tournaments by page, for the level and league summary
 * @param {Map<string, number>|null} [input.games] scoreboard games per player page in the window, or null when unavailable
 * @param {ReturnType<import("./generate.mjs").computeBaselines>} input.baselines
 */
export function buildPoolOps({ selection, tournamentIndex, games = null, baselines }) {
  const players = [];
  const staff = [];
  const skipped = [];
  for (const entry of [...selection.players, ...selection.staff]) {
    const { person } = entry;
    const profile = person.profile;
    const birth = isoDate(profile.birthDate);
    const country = countryOf(person);
    const rated = tierBaselines(baselines, person.tier);
    try {
      if (entry.kind === "player") {
        const { record, dobApprox, nationalityMissing } = generatePlayer({
          page: person.page, ign: profile.ign, realName: profile.name, country, position: entry.role, teamId: null, competition: null,
          infobox: { birthDate: birth, name: profile.name, country }, baselines: rated, takenIds: new Set(),
        });
        const op = { op: "add", player: record, evidence: pageUrl(person.page) };
        if (dobApprox) op.dob_approx = true;
        op.pool = poolMeta(entry, { tournamentIndex, games });
        players.push({ op, id: record.id, teamId: null, competition: null, note: `${profile.ign} (${record.full_name}) free agent ${entry.role}, tier ${person.tier}, ${person.region}${nationalityMissing ? "; nationality unresolved" : ""}` });
      } else {
        const { record } = generateStaff({
          canonicalTitle: person.page, ign: profile.ign, realName: profile.name, country, role: entry.role, teamId: null, baselines: rated, takenIds: new Set(),
        });
        const op = { op: "add", staff: record, evidence: pageUrl(person.page) };
        if (birth) record.date_of_birth = birth;
        else op.dob_approx = true;
        op.pool = poolMeta(entry, { tournamentIndex, games });
        staff.push({ op, id: record.id, teamId: null, competition: null, note: `${profile.ign} (${record.first_name}) free agent ${entry.role} (${person.staffLabel}), tier ${person.tier}, ${person.region}` });
      }
    } catch (error) {
      if (!(error instanceof IdCollisionError)) throw error;
      skipped.push({ kind: "add-failed", subject: person.page, detail: error.message });
    }
  }
  return { players, staff, skipped };
}
