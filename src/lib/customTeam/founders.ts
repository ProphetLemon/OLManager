import { invoke } from "@tauri-apps/api/core";

/**
 * Founding squad contract of the custom club wizard. Mirrors the Rust wire
 * types (`FounderSummary`, `FoundingSquadSummary`, `FounderOverrides`,
 * `FounderError`) by hand: no bindings are generated into `src/`.
 */

/** Role as `LolRole` serializes it. */
export type FounderRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

/** Role keys of `FounderOverrides`. */
export type FounderRoleKey = "top" | "jungle" | "mid" | "adc" | "support";

export const FOUNDER_ROLES: readonly FounderRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

const ROLE_KEY: Record<FounderRole, FounderRoleKey> = {
  TOP: "top",
  JUNGLE: "jungle",
  MID: "mid",
  ADC: "adc",
  SUPPORT: "support",
};

export const roleKey = (role: FounderRole): FounderRoleKey => ROLE_KEY[role];

/** Identity edits for one founder; a field left out keeps the generated value. */
export interface FounderIdentityOverride {
  nick?: string;
  full_name?: string;
  nationality?: string;
  /** `YYYY-MM-DD`. */
  birth_date?: string;
}

export type FounderOverrides = Partial<Record<FounderRoleKey, FounderIdentityOverride>>;

export type FounderField = "nick" | "full_name" | "nationality" | "birth_date";

export const FOUNDER_FIELDS: readonly FounderField[] = ["nick", "full_name", "nationality", "birth_date"];

export interface FounderAttributes {
  mechanics: number;
  laning: number;
  teamfighting: number;
  macro_play: number;
  consistency: number;
  shotcalling: number;
  champion_pool: number;
  discipline: number;
  mental_resilience: number;
}

export interface FounderSummary {
  id: string;
  role: FounderRole;
  nick: string;
  full_name: string;
  nationality: string;
  date_of_birth: string;
  age: number;
  birth_date_min: string;
  birth_date_max: string;
  ovr: number;
  attributes: FounderAttributes;
  wage: number;
  contract_end: string;
  market_value: number;
}

export interface FoundingSquadSummary {
  players: FounderSummary[];
  wage_budget: number;
  bill: number;
  /** ISO-2 codes the validator accepts as a founder nationality. */
  allowed_nationalities: string[];
}

/** Product cap on rerolls per club creation (a UI rule, not a backend one). */
export const MAX_REROLLS = 3;

/** Seed the backend takes as `u32`. */
export function newFoundingSeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0];
}

export interface PreviewFoundingSquadArgs {
  competitionId: string;
  replacedTeamId: string;
  shortName: string;
  seed: number;
  founderOverrides?: FounderOverrides;
}

export function previewFoundingSquad(args: PreviewFoundingSquadArgs): Promise<FoundingSquadSummary> {
  return invoke<FoundingSquadSummary>("preview_founding_squad", {
    competitionId: args.competitionId,
    replacedTeamId: args.replacedTeamId,
    shortName: args.shortName,
    seed: args.seed,
    founderOverrides: isEmptyOverrides(args.founderOverrides) ? null : args.founderOverrides,
  });
}

/** Rename one of the manager's own founders; resolves with the projected game. */
export function renamePlayer<TGame>(
  playerId: string,
  changes: { nick?: string; fullName?: string },
): Promise<TGame> {
  return invoke<TGame>("rename_player", {
    playerId,
    nick: changes.nick ?? null,
    fullName: changes.fullName ?? null,
  });
}

// ---------------------------------------------------------------- errors

export type FounderFieldReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_character"
  | "taken"
  | "not_in_region"
  | "invalid_date"
  | "age_changed";

export type FounderError =
  | { kind: "invalid_field"; role: FounderRole; field: FounderField; reason: FounderFieldReason }
  | { kind: "player_not_found"; player_id: string }
  | { kind: "not_a_founder"; player_id: string }
  | { kind: "nothing_to_change" };

const FIELD_REASONS: ReadonlySet<string> = new Set<FounderFieldReason>([
  "empty",
  "too_short",
  "too_long",
  "invalid_character",
  "taken",
  "not_in_region",
  "invalid_date",
  "age_changed",
]);

/** Parses a founder command rejection; `null` when it is not a founder error. */
export function parseFounderError(raw: unknown): FounderError | null {
  if (typeof raw !== "string" || !raw.trimStart().startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case "invalid_field": {
      const { role, field, reason } = record;
      if (
        typeof role === "string" &&
        (FOUNDER_ROLES as readonly string[]).includes(role) &&
        typeof field === "string" &&
        (FOUNDER_FIELDS as readonly string[]).includes(field) &&
        typeof reason === "string" &&
        FIELD_REASONS.has(reason)
      ) {
        return {
          kind: "invalid_field",
          role: role as FounderRole,
          field: field as FounderField,
          reason: reason as FounderFieldReason,
        };
      }
      return null;
    }
    case "player_not_found":
    case "not_a_founder":
      return typeof record.player_id === "string"
        ? { kind: record.kind, player_id: record.player_id }
        : null;
    case "nothing_to_change":
      return { kind: "nothing_to_change" };
    default:
      return null;
  }
}

/** Length bounds the backend enforces on the text fields (characters). */
export const FIELD_LIMITS = {
  nick: { min: 2, max: 16 },
  full_name: { min: 2, max: 40 },
} as const;

/** Interpolation values for an error message of `field`. */
export function limitsFor(field: FounderField): { min: number; max: number } {
  return field === "nick" || field === "full_name" ? FIELD_LIMITS[field] : { min: 0, max: 0 };
}

/** Locale key (under `teamSelect.founders.errors`) for an invalid-field reason. */
export function reasonKey(reason: FounderFieldReason): string {
  switch (reason) {
    case "empty":
      return "empty";
    case "too_short":
      return "tooShort";
    case "too_long":
      return "tooLong";
    case "invalid_character":
      return "invalidCharacter";
    case "taken":
      return "taken";
    case "not_in_region":
      return "notInRegion";
    case "invalid_date":
      return "invalidDate";
    case "age_changed":
      return "ageChanged";
  }
}

// ------------------------------------------------------------- overrides

export function isEmptyOverrides(overrides: FounderOverrides | undefined): boolean {
  return !overrides || Object.keys(overrides).length === 0;
}

/**
 * The edit as an override: only the fields that differ from the generated
 * founder, trimmed. `null` when nothing differs.
 */
export function diffOverride(
  founder: Pick<FounderSummary, "nick" | "full_name" | "nationality" | "date_of_birth">,
  edit: Partial<Record<FounderField, string>>,
): FounderIdentityOverride | null {
  const next: FounderIdentityOverride = {};
  const nick = edit.nick?.trim();
  if (nick !== undefined && nick !== founder.nick) next.nick = nick;
  const fullName = edit.full_name?.trim();
  if (fullName !== undefined && fullName !== founder.full_name) next.full_name = fullName;
  const nationality = edit.nationality?.trim();
  if (nationality !== undefined && nationality !== founder.nationality) next.nationality = nationality;
  const birth = edit.birth_date?.trim();
  if (birth !== undefined && birth !== founder.date_of_birth) next.birth_date = birth;
  return Object.keys(next).length === 0 ? null : next;
}

/** Overrides with `role` replaced (or removed when `override` is null). */
export function withRoleOverride(
  overrides: FounderOverrides,
  role: FounderRole,
  override: FounderIdentityOverride | null,
): FounderOverrides {
  const key = roleKey(role);
  const { [key]: _removed, ...rest } = overrides;
  void _removed;
  return override ? { ...rest, [key]: override } : rest;
}

/** Number of founders with at least one identity edit. */
export function overrideCount(overrides: FounderOverrides): number {
  return Object.keys(overrides).length;
}

// ------------------------------------------------------------ rename rule

export const FOUNDER_ID_PREFIX = "gen-";

/**
 * Whether the profile may offer Rename: the manager's own club player whose id
 * is a generated founder id. The backend enforces the same rule.
 */
export function canRenameFounder(
  player: { id: string; team_id: string | null },
  managerTeamId: string | null,
): boolean {
  return (
    managerTeamId !== null &&
    player.team_id === managerTeamId &&
    player.id.startsWith(FOUNDER_ID_PREFIX)
  );
}
