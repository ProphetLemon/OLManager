import type { Person, Tournament, TournamentClass } from "./pool-scope.mjs";
import type { PoolTournamentView } from "./pool.mjs";

export const PEOPLE_FILTER: string;
export const PEOPLE_FIELDS: string;
export const PEOPLE_GROUP: string;
export function cargoAll(client: { get(params: Record<string, string>): Promise<any> }, params: Record<string, string>): Promise<Array<Record<string, string>>>;

export interface PoolInputs {
  since: string;
  cap: number;
  tournaments: Tournament[];
  classes: Map<string, TournamentClass>;
  entryCount: Map<string, number>;
  view: ReturnType<typeof import("./pool.mjs").poolTournaments>;
  people: Map<string, Person>;
  games: Map<string, number> | null;
  probe: { page: string; entries: Array<{ page: string; role: string }> | null } | null;
  requests: Record<string, number>;
  warnings: string[];
}
export function fetchPoolInputs(input: {
  client: { get(params: Record<string, string>): Promise<any> };
  since?: string;
  cap?: number;
  probe?: string;
  log?: (message: string) => void;
}): Promise<PoolInputs>;
export type { PoolTournamentView };
