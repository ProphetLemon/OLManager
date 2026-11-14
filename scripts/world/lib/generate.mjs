// Deterministic records for players/staff that exist on Leaguepedia but not in the bundled world.
// Same input -> byte-identical output: ids come from a hash of the page title and attribute jitter is seeded by the id.
import { createHash } from "node:crypto";
import { countryToIso2 } from "./text.mjs";

export const PLAYER_ATTRIBUTES = [
  "mechanics",
  "laning",
  "teamfighting",
  "macro_play",
  "consistency",
  "shotcalling",
  "champion_pool",
  "discipline",
  "mental_resilience",
];
export const STAFF_ATTRIBUTES = ["coaching", "physiotherapy", "judging_ability", "judging_potential"];
export const JITTER = 4;

export class IdCollisionError extends Error {
  constructor(id, title) {
    super(`generated id ${id} for "${title}" collides with an existing id`);
    this.name = "IdCollisionError";
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** "player-" / "staff-" + first 8 hex of sha256("leaguepedia:" + canonical page title). */
export function deterministicId(prefix, canonicalTitle) {
  return `${prefix}-${sha256(`leaguepedia:${canonicalTitle}`).slice(0, 8)}`;
}

/** Integer in [-spread, spread] derived from the seed and a key. */
export function seededJitter(seed, key, spread = JITTER) {
  const byte = parseInt(sha256(`${seed}:${key}`).slice(0, 2), 16);
  return (byte % (2 * spread + 1)) - spread;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isDefaultAttributes = (attrs, keys) => keys.every((k) => attrs?.[k] === 50);

function collectRange(rows, keys) {
  const range = Object.fromEntries(keys.map((k) => [k, { min: 100, max: 1 }]));
  for (const row of rows) {
    for (const k of keys) {
      range[k].min = Math.min(range[k].min, row[k]);
      range[k].max = Math.max(range[k].max, row[k]);
    }
  }
  return range;
}

/** Real players a tier needs in a role before `tierPlayer` gives its median (as MIN_REAL_PLAYERS_PER_TIER_ROLE in the game). */
export const MIN_TIER_ROLE_PLAYERS = 10;

/**
 * Medians per competition + position (players) and per role (staff), with global fallbacks.
 * `tierPlayer(tier, position)` is the median of the real players of one tier in a role, or null when the tier has fewer
 * than MIN_TIER_ROLE_PLAYERS of them.
 */
export function computeBaselines(world) {
  const tierOf = new Map((world.competitions ?? []).map((c) => [c.id, c.tier]));
  const tierGroups = new Map();
  const tierPotentials = new Map();
  const playerGroups = new Map();
  const potentialGroups = new Map();
  const staffGroups = new Map();
  const pushTo = (map, key, value) => (map.has(key) ? map.get(key).push(value) : map.set(key, [value]));
  const playerRows = [];
  for (const p of world.players) {
    const attrs = p.raw.attributes;
    if (!p.competition || !attrs || isDefaultAttributes(attrs, PLAYER_ATTRIBUTES)) continue;
    playerRows.push(attrs);
    pushTo(playerGroups, `${p.competition}|${p.position}`, attrs);
    pushTo(playerGroups, `*|${p.position}`, attrs);
    const tier = tierOf.get(p.competition);
    if (tier != null) {
      pushTo(tierGroups, `${tier}|${p.position}`, attrs);
      if (p.raw.potential_base > 0) pushTo(tierPotentials, `${tier}|${p.position}`, p.raw.potential_base);
    }
    if (p.raw.potential_base > 0) {
      pushTo(potentialGroups, `${p.competition}|${p.position}`, p.raw.potential_base);
      pushTo(potentialGroups, `*|${p.position}`, p.raw.potential_base);
    }
  }
  const staffRows = [];
  for (const s of world.staff) {
    const attrs = s.raw.attributes;
    if (!attrs || s.role === "Owner") continue;
    staffRows.push(attrs);
    pushTo(staffGroups, s.role, attrs);
    pushTo(staffGroups, "*", attrs);
  }
  const playerRange = collectRange(playerRows, PLAYER_ATTRIBUTES);
  const staffRange = collectRange(staffRows, STAFF_ATTRIBUTES);
  const medians = (rows, keys) => Object.fromEntries(keys.map((k) => [k, median(rows.map((r) => r[k]))]));
  const MIN_GROUP = 5;

  return {
    player(competition, position) {
      const group = playerGroups.get(`${competition}|${position}`);
      const rows = group && group.length >= MIN_GROUP ? group : (playerGroups.get(`*|${position}`) ?? playerRows);
      const pots = potentialGroups.get(`${competition}|${position}`);
      const potRows = pots && pots.length >= MIN_GROUP ? pots : (potentialGroups.get(`*|${position}`) ?? [70]);
      return { attributes: medians(rows, PLAYER_ATTRIBUTES), potential: median(potRows), range: playerRange };
    },
    tierPlayer(tier, position) {
      const rows = tierGroups.get(`${tier}|${position}`);
      if (!rows || rows.length < MIN_TIER_ROLE_PLAYERS) return null;
      const pots = tierPotentials.get(`${tier}|${position}`);
      const potential = pots && pots.length >= MIN_GROUP ? median(pots) : (potentialGroups.get(`*|${position}`) ? median(potentialGroups.get(`*|${position}`)) : 70);
      return { attributes: medians(rows, PLAYER_ATTRIBUTES), potential, range: playerRange };
    },
    staff(role) {
      const group = staffGroups.get(role);
      const rows = group && group.length >= MIN_GROUP ? group : (staffGroups.get("*") ?? staffRows);
      return { attributes: medians(rows, STAFF_ATTRIBUTES), range: staffRange };
    },
  };
}

function jitteredAttributes(seed, base, keys, range) {
  return Object.fromEntries(
    keys.map((k) => [k, clamp(base[k] + seededJitter(seed, k), range[k].min, range[k].max)]),
  );
}

/** Approximate birth date when the player page has none (flagged `dob_approx` on the op). */
export function approximateBirthDate(seed) {
  const n = parseInt(sha256(`${seed}:dob`).slice(0, 8), 16);
  const year = 2000 + (n % 5);
  const month = 1 + (Math.floor(n / 7) % 12);
  const day = 1 + (Math.floor(n / 13) % 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * @returns {{record: object, dobApprox: boolean, nationalityMissing: boolean}}
 */
export function generatePlayer({ page, ign, realName, country, position, teamId, competition, infobox, baselines, takenIds }) {
  const id = deterministicId("player", page);
  if (takenIds?.has(id)) throw new IdCollisionError(id, page);
  const base = baselines.player(competition, position);
  const birth = infobox?.birthDate ?? null;
  const nationality = countryToIso2(country) || countryToIso2(infobox?.country);
  const potential = clamp(base.potential + seededJitter(id, "potential_base"), 1, 100);
  const record = {
    id,
    wage: 0,
    career: [],
    injury: null,
    morale: 100,
    fitness: 100,
    team_id: teamId,
    condition: 100,
    full_name: infobox?.name || realName || ign,
    attributes: jitteredAttributes(id, base.attributes, PLAYER_ATTRIBUTES, base.range),
    match_name: ign,
    loan_listed: false,
    morale_core: {},
    contract_end: "",
    market_value: 0,
    potential_base: potential,
    transfer_listed: false,
    transfer_offers: [],
    champion_mastery: [],
    alternate_positions: [],
    position,
    nationality,
    date_of_birth: birth ?? approximateBirthDate(id),
    stats: {},
    profile_image_url: null,
  };
  return { record, dobApprox: !birth, nationalityMissing: !nationality };
}

/**
 * Staff on a team keep the roster refresh's convention (the country name, as the game's staff files carry it); a free-agent
 * staff add (no team) carries an ISO-2 code like a player, empty when the country does not resolve.
 * @returns {{record: object, dobApprox: boolean, nationalityMissing: boolean}}
 */
export function generateStaff({ canonicalTitle, ign, realName, country, role, teamId, baselines, takenIds }) {
  const id = deterministicId("staff", canonicalTitle);
  if (takenIds?.has(id)) throw new IdCollisionError(id, canonicalTitle);
  const base = baselines.staff(role);
  const fullName = realName || ign;
  const teamless = teamId === null;
  const nationality = teamless ? countryToIso2(country) : (country ?? "");
  const record = {
    id,
    role,
    wage: null,
    team_id: teamId,
    last_name: fullName.split(/\s+/).filter(Boolean).at(-1) ?? "",
    attributes: jitteredAttributes(id, base.attributes, STAFF_ATTRIBUTES, base.range),
    first_name: fullName,
    nationality,
    contract_end: null,
    birth_country: null,
    date_of_birth: "1990-01-01",
    specialization: null,
    profile_image_url: null,
    nickname: ign || fullName,
  };
  return { record, dobApprox: true, nationalityMissing: teamless && !nationality };
}
