import type { WorldPlayer, WorldStaff } from "./world.mjs";

export interface IdMap {
  players?: Array<{ page: string; id: string; note?: string }>;
  staff?: Array<{ page: string; id: string; note?: string }>;
  rejections?: Array<{ page: string; id: string; kind?: "player" | "staff"; reason?: string }>;
}
export interface Entity {
  id: string;
  ign: string;
  name: string;
  nat: string;
  stale: boolean;
  ref: any;
}
export interface Person {
  ign: string;
  page?: string | null;
  realName: string;
  country: string | null;
}
export interface MatchResult {
  status: "matched" | "ambiguous" | "refused" | "none";
  entity?: Entity;
  confidence?: string;
  candidates?: Entity[];
  reason?: string;
}
export const EMPTY_ID_MAP: Readonly<IdMap>;
export function playerEntity(player: WorldPlayer): Entity;
export function staffEntity(staff: WorldStaff): Entity;
export function buildIndex(entities: Entity[]): unknown;
export function matchPerson(person: Person, index: unknown, context: { kind: "player" | "staff"; overrides?: IdMap }): MatchResult;
