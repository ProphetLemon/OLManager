// Contract v1 of `assets/world/roster-overlay.json` and its validator.
// The validator is pure: pass an optional world (id sets) to also check references.

export const OVERLAY_SCHEMA_VERSION = 1;
export const POSITIONS = Object.freeze(["Top", "Jungle", "Mid", "ADC", "Support"]);
/** Roles an overlay `move` may set. Owners and Assistants are protected (see staff-policy.mjs). */
export const MOVABLE_STAFF_ROLES = Object.freeze(["HeadCoach", "Analyst", "Performance Coach", "Scout", "Coach"]);
export const ADDED_STAFF_ROLES = Object.freeze(["HeadCoach", "Analyst", "Performance Coach", "Scout"]);
export const PLAYER_ATTRIBUTE_KEYS = Object.freeze([
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
export const STAFF_ATTRIBUTE_KEYS = Object.freeze(["coaching", "physiotherapy", "judging_ability", "judging_potential"]);

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";
const isDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isHttpsUrl = (value) => typeof value === "string" && /^https:\/\/\S+$/.test(value);
const isRating = (value) => Number.isInteger(value) && value >= 1 && value <= 100;

class Errors {
  constructor() {
    this.list = [];
  }
  add(path, code, message) {
    this.list.push({ path, code, message });
  }
}

function checkEvidence(op, path, errors) {
  if (!isHttpsUrl(op.evidence)) errors.add(`${path}.evidence`, "invalid_evidence", "evidence must be an https URL");
}

function checkAttributes(attributes, keys, path, errors) {
  if (!isRecord(attributes)) return errors.add(path, "invalid_attributes", "attributes must be an object");
  for (const key of keys) {
    if (!isRating(attributes[key])) errors.add(`${path}.${key}`, "invalid_attribute", `${key} must be an integer 1..100`);
  }
}

function checkPlayerRecord(record, path, errors) {
  if (!isRecord(record)) return errors.add(path, "invalid_record", "player must be an object");
  if (!/^player-[0-9a-f]{8}$/.test(record.id ?? "")) errors.add(`${path}.id`, "invalid_id", "added player ids look like player-xxxxxxxx");
  if (!isNonEmptyString(record.full_name)) errors.add(`${path}.full_name`, "invalid_field", "full_name is required");
  if (!isNonEmptyString(record.match_name)) errors.add(`${path}.match_name`, "invalid_field", "match_name is required");
  if (!POSITIONS.includes(record.position)) errors.add(`${path}.position`, "invalid_position", `position must be one of ${POSITIONS.join(", ")}`);
  if (typeof record.nationality !== "string" || !/^([A-Z]{2})?$/.test(record.nationality)) errors.add(`${path}.nationality`, "invalid_field", "nationality must be an ISO-2 code or empty");
  if (!isDate(record.date_of_birth)) errors.add(`${path}.date_of_birth`, "invalid_field", "date_of_birth must be YYYY-MM-DD");
  for (const key of ["wage", "market_value"]) {
    if (!Number.isFinite(record[key]) || record[key] < 0) errors.add(`${path}.${key}`, "invalid_field", `${key} must be a non-negative number`);
  }
  if (typeof record.contract_end !== "string") errors.add(`${path}.contract_end`, "invalid_field", "contract_end must be a string");
  if (!isRating(record.potential_base)) errors.add(`${path}.potential_base`, "invalid_field", "potential_base must be an integer 1..100");
  if (record.team_id !== null && !isNonEmptyString(record.team_id)) errors.add(`${path}.team_id`, "invalid_field", "team_id must be a string or null");
  checkAttributes(record.attributes, PLAYER_ATTRIBUTE_KEYS, `${path}.attributes`, errors);
}

function checkStaffRecord(record, path, errors) {
  if (!isRecord(record)) return errors.add(path, "invalid_record", "staff must be an object");
  if (!/^staff-[0-9a-f]{8}$/.test(record.id ?? "")) errors.add(`${path}.id`, "invalid_id", "added staff ids look like staff-xxxxxxxx");
  if (!ADDED_STAFF_ROLES.includes(record.role)) errors.add(`${path}.role`, "invalid_role", `added staff role must be one of ${ADDED_STAFF_ROLES.join(", ")}`);
  if (!isNonEmptyString(record.nickname)) errors.add(`${path}.nickname`, "invalid_field", "nickname is required");
  if (!isNonEmptyString(record.first_name)) errors.add(`${path}.first_name`, "invalid_field", "first_name is required");
  if (record.team_id !== null && !isNonEmptyString(record.team_id)) errors.add(`${path}.team_id`, "invalid_field", "team_id must be a string or null");
  // Staff on a team carry the country name, as the game's staff files do; a free-agent add carries an ISO-2 code like a player.
  if (record.team_id === null && (typeof record.nationality !== "string" || !/^([A-Z]{2})?$/.test(record.nationality))) errors.add(`${path}.nationality`, "invalid_field", "nationality of a staff add without a team must be an ISO-2 code or empty");
  checkAttributes(record.attributes, STAFF_ATTRIBUTE_KEYS, `${path}.attributes`, errors);
}

function checkSource(source, errors) {
  if (!isRecord(source)) return errors.add("source", "invalid_source", "source must be an object");
  for (const key of ["name", "license", "attribution"]) {
    if (!isNonEmptyString(source[key])) errors.add(`source.${key}`, "invalid_source", `source.${key} is required`);
  }
  for (const key of ["url", "license_url"]) {
    if (!isHttpsUrl(source[key])) errors.add(`source.${key}`, "invalid_source", `source.${key} must be an https URL`);
  }
}

function checkTeam(teamId, path, world, errors) {
  if (teamId === null || !world) return;
  if (!world.teamIds.has(teamId)) errors.add(path, "unknown_team", `team ${teamId} is not in the game world`);
}

function checkSection({ ops, section, world, errors }) {
  const isPlayers = section === "players";
  const ids = new Set();
  const knownIds = world ? (isPlayers ? world.playerIds : world.staffIds) : null;
  if (!Array.isArray(ops)) return errors.add(section, "invalid_section", `${section} must be an array`);
  ops.forEach((op, index) => {
    const path = `${section}[${index}]`;
    if (!isRecord(op)) return errors.add(path, "invalid_op", "op must be an object");
    const kinds = isPlayers ? ["move", "retire", "add"] : ["move", "add"];
    if (!kinds.includes(op.op)) return errors.add(`${path}.op`, "unknown_op", `unknown op "${String(op.op)}"`);
    checkEvidence(op, path, errors);
    const subjectId = op.op === "add" ? (isPlayers ? op.player?.id : op.staff?.id) : op.id;
    if (typeof subjectId === "string") {
      if (ids.has(subjectId)) errors.add(path, "duplicate_id", `id ${subjectId} appears in more than one op`);
      ids.add(subjectId);
    }
    if (op.op === "add") {
      const record = isPlayers ? op.player : op.staff;
      (isPlayers ? checkPlayerRecord : checkStaffRecord)(record, `${path}.${isPlayers ? "player" : "staff"}`, errors);
      if (knownIds && typeof record?.id === "string" && knownIds.has(record.id)) errors.add(`${path}.id`, "id_exists", `${record.id} already exists in the game world`);
      checkTeam(record?.team_id ?? null, `${path}.team_id`, world, errors);
      return;
    }
    if (!isNonEmptyString(op.id)) errors.add(`${path}.id`, "invalid_id", "id is required");
    else if (knownIds && !knownIds.has(op.id)) errors.add(`${path}.id`, "unknown_id", `${op.id} is not in the game world`);
    if (op.op === "retire") return;
    if (op.team_id !== null && !isNonEmptyString(op.team_id)) errors.add(`${path}.team_id`, "invalid_field", "team_id must be a string or null");
    else checkTeam(op.team_id, `${path}.team_id`, world, errors);
    if (isPlayers) {
      if (op.position !== undefined && !POSITIONS.includes(op.position)) errors.add(`${path}.position`, "invalid_position", "unknown position");
      if (op.contract_end !== undefined && !isDate(op.contract_end)) errors.add(`${path}.contract_end`, "invalid_field", "contract_end must be YYYY-MM-DD");
    } else if (op.role !== undefined && !MOVABLE_STAFF_ROLES.includes(op.role)) {
      errors.add(`${path}.role`, "invalid_role", `role must be one of ${MOVABLE_STAFF_ROLES.join(", ")}`);
    }
  });
}

/**
 * @param {unknown} overlay parsed overlay JSON
 * @param {{playerIds: ReadonlySet<string>, staffIds: ReadonlySet<string>, teamIds: ReadonlySet<string>, competitionIds?: ReadonlySet<string>}} [world]
 * @returns {{ok: boolean, errors: Array<{path: string, code: string, message: string}>}}
 */
export function validateOverlay(overlay, world) {
  const errors = new Errors();
  if (!isRecord(overlay)) {
    errors.add("", "invalid_overlay", "overlay must be a JSON object");
    return { ok: false, errors: errors.list };
  }
  if (overlay.schemaVersion !== OVERLAY_SCHEMA_VERSION) {
    errors.add("schemaVersion", "unsupported_schema_version", `unsupported schemaVersion ${JSON.stringify(overlay.schemaVersion)}; expected ${OVERLAY_SCHEMA_VERSION}`);
    return { ok: false, errors: errors.list };
  }
  if (!isDate(overlay.as_of)) errors.add("as_of", "invalid_field", "as_of must be YYYY-MM-DD");
  checkSource(overlay.source, errors);
  if (!Array.isArray(overlay.coverage) || !overlay.coverage.every(isNonEmptyString) || new Set(overlay.coverage).size !== overlay.coverage.length) {
    errors.add("coverage", "invalid_field", "coverage must be a list of unique competition ids");
  } else if (world?.competitionIds) {
    overlay.coverage.forEach((id, index) => {
      if (!world.competitionIds.has(id)) errors.add(`coverage[${index}]`, "unknown_competition", `competition ${id} is not in the game world`);
    });
  }
  checkSection({ ops: overlay.players, section: "players", world, errors });
  checkSection({ ops: overlay.staff, section: "staff", world, errors });
  return { ok: errors.list.length === 0, errors: errors.list };
}

export function formatErrors(errors) {
  return errors.map((e) => `${e.path || "(root)"}: [${e.code}] ${e.message}`).join("\n");
}
