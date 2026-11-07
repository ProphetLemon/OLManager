export const OVERLAY_SCHEMA_VERSION: 1;
export const POSITIONS: readonly string[];
export const MOVABLE_STAFF_ROLES: readonly string[];
export const ADDED_STAFF_ROLES: readonly string[];
export const PLAYER_ATTRIBUTE_KEYS: readonly string[];
export const STAFF_ATTRIBUTE_KEYS: readonly string[];

export interface OverlayWorldIds {
  playerIds: ReadonlySet<string>;
  staffIds: ReadonlySet<string>;
  teamIds: ReadonlySet<string>;
  competitionIds?: ReadonlySet<string>;
}
export interface OverlayValidationError {
  path: string;
  code: string;
  message: string;
}
export interface OverlayValidationResult {
  ok: boolean;
  errors: OverlayValidationError[];
}
export interface OverlaySource {
  name: string;
  url: string;
  license: string;
  license_url: string;
  attribution: string;
}
export type PlayerOp =
  | { op: "move"; id: string; team_id: string | null; position?: string; contract_end?: string; evidence: string }
  | { op: "retire"; id: string; evidence: string }
  | { op: "add"; player: Record<string, unknown>; evidence: string; dob_approx?: boolean };
export type StaffOp =
  | { op: "move"; id: string; team_id: string | null; role?: string; evidence: string }
  | { op: "add"; staff: Record<string, unknown>; evidence: string; dob_approx?: boolean };
export interface RosterOverlay {
  schemaVersion: number;
  as_of: string;
  source: OverlaySource;
  coverage: string[];
  players: PlayerOp[];
  staff: StaffOp[];
}

export function validateOverlay(overlay: unknown, world?: OverlayWorldIds): OverlayValidationResult;
export function formatErrors(errors: ReadonlyArray<OverlayValidationError>): string;
