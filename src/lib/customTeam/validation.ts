import type { TeamSummary } from "@/store/types";

/** Machine-readable validation outcome; the UI maps each code to an i18n key. */
export type ValidationCode = "required" | "tooShort" | "tooLong" | "format" | "duplicate";

export type CustomTeamField = "name" | "shortName" | "primary" | "secondary" | "country" | "replaces";

export interface CustomTeamDraft {
  name: string;
  shortName: string;
  primary: string;
  secondary: string;
  country: string;
  replacesTeamId: string | null;
}

export interface CustomTeamValidation {
  ok: boolean;
  errors: Partial<Record<CustomTeamField, ValidationCode>>;
}

export const NAME_MIN = 3;
export const NAME_MAX = 30;
export const SHORT_NAME_MIN = 3;
export const SHORT_NAME_MAX = 4;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SHORT_NAME_CHARS = /^[A-Za-z0-9]+$/;

/** Case- and accent-insensitive comparison key. */
function foldKey(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Lowercase `#rrggbb`; returns the input trimmed when it is not a valid color. */
export function normalizeColor(value: string): string {
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

/** Trim and uppercase a short name the way the backend normalises it. */
export function normalizeShortName(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Mirrors the Rust `validate_spec` rules. `leagueTeams` is the selected
 * league's roster; the replaced team is excluded so its own name stays usable.
 * The backend still checks uniqueness world-wide.
 */
export function validateCustomTeam(
  draft: CustomTeamDraft,
  leagueTeams: readonly Pick<TeamSummary, "id" | "name" | "short_name">[],
): CustomTeamValidation {
  const errors: CustomTeamValidation["errors"] = {};
  const others = leagueTeams.filter((team) => team.id !== draft.replacesTeamId);

  const name = draft.name.trim();
  if (!name) errors.name = "required";
  else if (name.length < NAME_MIN) errors.name = "tooShort";
  else if (name.length > NAME_MAX) errors.name = "tooLong";
  else if (others.some((team) => foldKey(team.name) === foldKey(name))) errors.name = "duplicate";

  const short = draft.shortName.trim();
  if (!short) errors.shortName = "required";
  else if (!SHORT_NAME_CHARS.test(short)) errors.shortName = "format";
  else if (short.length < SHORT_NAME_MIN) errors.shortName = "tooShort";
  else if (short.length > SHORT_NAME_MAX) errors.shortName = "tooLong";
  else if (others.some((team) => foldKey(team.short_name) === foldKey(short))) errors.shortName = "duplicate";

  if (!draft.primary.trim()) errors.primary = "required";
  else if (!HEX_COLOR.test(draft.primary.trim())) errors.primary = "format";

  if (!draft.secondary.trim()) errors.secondary = "required";
  else if (!HEX_COLOR.test(draft.secondary.trim())) errors.secondary = "format";

  if (!draft.country.trim()) errors.country = "required";

  if (!draft.replacesTeamId) errors.replaces = "required";

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Team to pre-select as the replaced slot: lowest reputation, ties broken by
 * id. Teams without a known reputation are never auto-picked (their data is
 * not trustworthy yet), so `null` is returned when none has one.
 */
export function defaultReplacementId(
  teams: readonly Pick<TeamSummary, "id" | "reputation">[],
): string | null {
  let best: { id: string; reputation: number } | null = null;
  for (const team of teams) {
    if (team.reputation == null) continue;
    if (
      best === null ||
      team.reputation < best.reputation ||
      (team.reputation === best.reputation && team.id < best.id)
    ) {
      best = { id: team.id, reputation: team.reputation };
    }
  }
  return best?.id ?? null;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

/** WCAG contrast ratio (1-21) between two `#rrggbb` colors; 1 when either is invalid. */
export function contrastRatio(a: string, b: string): number {
  if (!HEX_COLOR.test(a) || !HEX_COLOR.test(b)) return 1;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Below this ratio the badge text is hard to read; the UI shows a soft warning. */
export const LOW_CONTRAST_RATIO = 3;

/**
 * Backend `CustomTeamError` messages that map to a field error. Kept in one
 * table so the wizard and its tests share it; patterns are matched against the
 * lowercased message, most specific first.
 */
const BACKEND_ERROR_TABLE: ReadonlyArray<{
  pattern: RegExp;
  field: CustomTeamField;
  code: ValidationCode;
}> = [
  { pattern: /short name.*(already|duplicate|taken|exists)/, field: "shortName", code: "duplicate" },
  { pattern: /(already|duplicate|taken|exists).*short name/, field: "shortName", code: "duplicate" },
  { pattern: /name.*(already|duplicate|taken|exists)/, field: "name", code: "duplicate" },
  { pattern: /(already|duplicate|taken|exists).*name/, field: "name", code: "duplicate" },
];

/** Map a backend error string to a field error, or `null` when it is not one we localise. */
export function mapBackendCustomTeamError(
  message: string,
): { field: CustomTeamField; code: ValidationCode } | null {
  const lowered = message.toLowerCase();
  const hit = BACKEND_ERROR_TABLE.find((row) => row.pattern.test(lowered));
  return hit ? { field: hit.field, code: hit.code } : null;
}
