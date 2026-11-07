// Loads the bundled game world (data/) the way `assemble_world_from_modular_data` does
// (src-tauri/src/commands/game.rs): every non-legacy competition manifest, ids prefixed with
// the competition id, free agents injected last and de-duplicated by id.
import fs from "node:fs";
import path from "node:path";

/** Stale duplicates of a live competition that the game still loads (same people, other team ids). */
export const STALE_DUPLICATE_COMPETITIONS = Object.freeze({ "lck-cl": "lckcl", prime_league: "prm" });

/** Reviewed field fixes shared with the game (src-tauri/crates/olm_core/src/world_catalog.rs). */
export const CATALOG_CORRECTIONS_FILE = path.resolve(import.meta.dirname, "../../../assets/world/catalog-corrections.json");
const CORRECTABLE_FIELDS = new Set(["full_name", "match_name", "nationality"]);

/** Read the corrections document; a missing or malformed file means no corrections. */
export function readCatalogCorrections(file = CATALOG_CORRECTIONS_FILE) {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(json?.corrections) ? json.corrections : [];
  } catch {
    return [];
  }
}

/**
 * Apply corrections to normalized players in place, like `apply_catalog_corrections` in Rust:
 * unknown id/field or a `from` mismatch is skipped and reported, never thrown.
 */
export function applyCatalogCorrections(players, corrections) {
  const byId = new Map(players.map((p) => [p.id, p]));
  let applied = 0;
  const skipped = [];
  for (const c of corrections) {
    const player = byId.get(c.id);
    if (!player) skipped.push(`${c.id}: unknown player id`);
    else if (!CORRECTABLE_FIELDS.has(c.field)) skipped.push(`${c.id}: unsupported field '${c.field}'`);
    else if (player[c.field] !== c.from) skipped.push(`${c.id}.${c.field}: expected '${c.from}' but found '${player[c.field]}'`);
    else {
      player[c.field] = c.to;
      player.raw = { ...player.raw, [c.field]: c.to };
      applied += 1;
    }
  }
  return { applied, skipped };
}

const FREE_AGENT_MARKERS = new Set(["fa", "freeagent"]);

/** Read a shard that is either a bare array or an object wrapping the array under `key`. */
export function readShard(file, key) {
  if (!fs.existsSync(file)) return null;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(json)) return json;
  return Array.isArray(json?.[key]) ? json[key] : [];
}

/** game.rs: ids are prefixed with `<competition>-` unless they already carry it; "fa" markers stay free agents. */
export function effectiveTeamId(rawId, competitionId) {
  if (rawId === null || rawId === undefined || rawId === "") return null;
  if (FREE_AGENT_MARKERS.has(rawId)) return null;
  const prefix = `${competitionId}-`;
  return rawId.startsWith(prefix) ? rawId : prefix + rawId;
}

function scanManifests(dataDir) {
  const base = path.join(dataDir, "competitions");
  const manifests = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(base, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    manifests.push(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  }
  return manifests.filter((m) => !m.legacy).sort((a, b) => a.id.localeCompare(b.id));
}

function staffShardPath(dataDir, manifest) {
  const explicit = typeof manifest.staff_file === "string" ? manifest.staff_file.trim() : "";
  if (explicit) return path.join(dataDir, explicit);
  const conventional = path.join(dataDir, "staffs", `${manifest.id}_staffs.json`);
  return fs.existsSync(conventional) ? conventional : null;
}

function normalizePlayer(raw, competition, shard) {
  return {
    id: raw.id,
    match_name: raw.match_name ?? "",
    full_name: raw.full_name ?? "",
    position: raw.position ?? "",
    nationality: raw.nationality ?? "",
    date_of_birth: raw.date_of_birth ?? null,
    team_id: competition ? effectiveTeamId(raw.team_id, competition) : effectiveTeamId(raw.team_id, ""),
    competition,
    shard,
    raw,
  };
}

function normalizeStaff(raw, competition, shard) {
  return {
    id: raw.id,
    nickname: raw.nickname ?? "",
    first_name: raw.first_name ?? "",
    last_name: raw.last_name ?? "",
    role: raw.role ?? "",
    nationality: raw.nationality ?? "",
    team_id: competition ? effectiveTeamId(raw.team_id, competition) : (raw.team_id ?? null),
    competition,
    shard,
    raw,
  };
}

/** Keep the first record per id; remember every shard an id appeared in. */
function dedupe(records) {
  const byId = new Map();
  const duplicates = new Map();
  for (const record of records) {
    const first = byId.get(record.id);
    if (!first) {
      byId.set(record.id, record);
      continue;
    }
    if (!duplicates.has(record.id)) duplicates.set(record.id, [first.shard]);
    duplicates.get(record.id).push(record.shard);
  }
  return {
    records: [...byId.values()],
    duplicates: [...duplicates].map(([id, shards]) => ({ id, shards })),
  };
}

/**
 * @param {string} dataDir path to the `data/` directory
 * @param {{corrections?: object[]}} [options] reviewed field fixes; defaults to assets/world/catalog-corrections.json
 */
export function loadWorld(dataDir, { corrections = readCatalogCorrections() } = {}) {
  const manifests = scanManifests(dataDir);
  // Live competitions first so a stale duplicate never wins an id.
  const ordered = [
    ...manifests.filter((m) => !(m.id in STALE_DUPLICATE_COMPETITIONS)),
    ...manifests.filter((m) => m.id in STALE_DUPLICATE_COMPETITIONS),
  ];

  const teams = new Map();
  const competitions = [];
  const players = [];
  const staff = [];

  for (const manifest of ordered) {
    const cid = manifest.id;
    const teamRows = readShard(path.join(dataDir, manifest.teams_file ?? ""), "teams") ?? [];
    const playerRows = readShard(path.join(dataDir, manifest.players_file ?? ""), "players") ?? [];
    const staffFile = staffShardPath(dataDir, manifest);
    const staffRows = (staffFile ? readShard(staffFile, "staff") : null) ?? [];

    const teamIds = [];
    for (const raw of teamRows) {
      const id = effectiveTeamId(raw.id, cid);
      teamIds.push(id);
      teams.set(id, {
        id,
        name: raw.name ?? "",
        short_name: raw.short_name ?? "",
        country: raw.country ?? "",
        team_kind: raw.team_kind ?? null,
        competition: cid,
      });
    }
    for (const raw of playerRows) players.push(normalizePlayer(raw, cid, `players/${cid}`));
    for (const raw of staffRows) staff.push(normalizeStaff(raw, cid, `staffs/${cid}`));

    const staleOf = STALE_DUPLICATE_COMPETITIONS[cid] ?? null;
    competitions.push({
      id: cid,
      name: manifest.name ?? cid,
      tier: manifest.tier ?? null,
      teamIds,
      playerCount: playerRows.length,
      staleOf,
      covered: playerRows.length > 0 && !staleOf,
      skipReason: staleOf ? `stale duplicate of ${staleOf}` : playerRows.length === 0 ? "no players loaded" : null,
    });
  }

  // Free agents are injected after all competitions and skipped when the id already exists.
  const faPlayers = (readShard(path.join(dataDir, "players", "free_agents.json"), "players") ?? []).map((raw) =>
    normalizePlayer({ ...raw, team_id: null }, null, "players/free_agents"),
  );
  const faStaff = (readShard(path.join(dataDir, "staffs", "free_agents.json"), "staff") ?? []).map((raw) =>
    normalizeStaff({ ...raw, team_id: null }, null, "staffs/free_agents"),
  );

  const playerResult = dedupe([...players, ...faPlayers]);
  const correctionReport = applyCatalogCorrections(playerResult.records, corrections);
  // Players on teams that do not exist are free agents, as in the game.
  for (const player of playerResult.records) {
    if (player.team_id && !teams.has(player.team_id)) player.team_id = null;
  }
  const staffResult = dedupe([...staff, ...faStaff]);

  return {
    dataDir,
    competitions,
    teams,
    players: playerResult.records,
    staff: staffResult.records,
    corrections: correctionReport,
    duplicates: { players: playerResult.duplicates, staff: staffResult.duplicates },
  };
}

export function coveredCompetitionIds(world) {
  return world.competitions.filter((c) => c.covered).map((c) => c.id);
}

/** Id sets used by the overlay validator. */
export function toOverlayWorld(world) {
  return {
    playerIds: new Set(world.players.map((p) => p.id)),
    staffIds: new Set(world.staff.map((s) => s.id)),
    teamIds: new Set(world.teams.keys()),
    competitionIds: new Set(world.competitions.map((c) => c.id)),
  };
}
