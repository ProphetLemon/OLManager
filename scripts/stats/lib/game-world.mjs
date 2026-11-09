// The game's players as the world build sees them, for matching Leaguepedia players and for the league ladder.
//
// Reuses scripts/world/lib/world.mjs (loadWorld: manifests, effective team ids, free agents, catalog corrections) and
// applies the signed roster overlay with the same rules as `apply_world_overlay` (olm_core/src/world_overlay.rs):
// moves, retirements and adds, in file order. Not reproduced from the Rust assembly (they do not change which
// player has which authored attributes, but they change who exists):
//   - academy teams and players bootstrapped from the ERL catalog (generated at new-game time),
//   - `fill_short_rosters` fills (generated players),
//   - `scrub_departed_players` (clean-up of references after moves),
//   - `estimate_placeholder_ratings` (flat-50 rows get an estimate in the game; here they are only flagged),
//   - contract and market-value defaults (wage and market_value are the authored values).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorld } from "../../world/lib/world.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_DATA_DIR = path.join(root, "data");
export const DEFAULT_OVERLAY_FILE = path.join(root, "assets/world/roster-overlay.json");

export const ATTRIBUTE_NAMES = Object.freeze([
  "mechanics",
  "laning",
  "teamfighting",
  "macro_play",
  "consistency",
  "shotcalling",
  "champion_pool",
  "discipline",
  "mental_resilience",
]);

/** olm_core `calculate_lol_ovr`: the mean of the nine attributes, rounded, clamped to 1..99. */
export function calculateLolOvr(attributes) {
  const sum = ATTRIBUTE_NAMES.reduce((total, name) => total + Number(attributes?.[name] ?? 0), 0);
  return Math.min(99, Math.max(1, Math.round(sum / ATTRIBUTE_NAMES.length)));
}

function toGamePlayer(raw, teamId, competition) {
  const attributes = Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, Number(raw.attributes?.[name] ?? 0)]));
  const values = Object.values(attributes);
  return {
    id: raw.id,
    match_name: raw.match_name ?? "",
    full_name: raw.full_name ?? "",
    team_id: teamId,
    competition,
    position: raw.position ?? "",
    attributes,
    potential_base: Number(raw.potential_base ?? 0),
    market_value: Number(raw.market_value ?? 0),
    wage: Number(raw.wage ?? 0),
    authoredOvr: calculateLolOvr(attributes),
    isFlat50: values.every((v) => v === 50),
    isAllZero: values.every((v) => v === 0),
  };
}

/**
 * @param options.dataDir `data/` directory
 * @param options.overlayFile roster overlay JSON, or null for none
 * @param options.corrections catalog corrections (default: assets/world/catalog-corrections.json)
 * @returns {players, teams, report} players sorted by id; `competition` is the competition of the player's team
 */
export function loadGamePlayers({ dataDir = DEFAULT_DATA_DIR, overlayFile = DEFAULT_OVERLAY_FILE, corrections } = {}) {
  const world = loadWorld(dataDir, corrections ? { corrections } : undefined);
  const records = world.players.map((p) => ({ raw: p.raw, id: p.id, team_id: p.team_id }));
  const position = new Map();
  const skipped = [];
  let moved = 0;
  let retired = 0;
  let added = 0;

  const overlay = overlayFile && fs.existsSync(overlayFile) ? JSON.parse(fs.readFileSync(overlayFile, "utf8")) : null;
  for (const op of overlay?.players ?? []) {
    if (op.op === "move") {
      const record = records.find((r) => r.id === op.id);
      if (op.team_id !== null && !world.teams.has(op.team_id)) skipped.push(`${op.id}: unknown team ${op.team_id}`);
      else if (!record) skipped.push(`${op.id}: unknown player`);
      else {
        record.team_id = op.team_id;
        if (op.position) position.set(op.id, op.position);
        moved += 1;
      }
    } else if (op.op === "retire") {
      const index = records.findIndex((r) => r.id === op.id);
      if (index < 0) skipped.push(`${op.id}: unknown player`);
      else {
        records.splice(index, 1);
        retired += 1;
      }
    } else if (op.op === "add") {
      const raw = op.player;
      if (records.some((r) => r.id === raw.id)) skipped.push(`${raw.id}: duplicate id`);
      else if (raw.team_id && !world.teams.has(raw.team_id)) skipped.push(`${raw.id}: unknown team ${raw.team_id}`);
      else {
        records.push({ raw, id: raw.id, team_id: raw.team_id ?? null });
        added += 1;
      }
    }
  }

  const players = records
    .map((r) => {
      const raw = position.has(r.id) ? { ...r.raw, position: position.get(r.id) } : r.raw;
      return toGamePlayer(raw, r.team_id, r.team_id ? (world.teams.get(r.team_id)?.competition ?? null) : null);
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    players,
    teams: world.teams,
    report: { overlay: { moved, retired, added, skipped }, corrections: world.corrections },
  };
}
