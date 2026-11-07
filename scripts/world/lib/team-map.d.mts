import type { World } from "./world.mjs";
import type { MediaWikiClient } from "./mediawiki-client.mjs";

export interface TeamMapEntry {
  title: string | null;
  name: string;
  competition: string;
  via?: string;
  reason?: string;
  manual?: boolean;
}
export interface TeamMap {
  schemaVersion: number;
  teams: Record<string, TeamMapEntry>;
}
export function loadTeamMap(file: string): TeamMap;
export function titleVariants(name: string): string[];
export function buildTeamMap(input: { client: MediaWikiClient; world: World; competitions: string[]; existing?: Partial<TeamMap> }): Promise<TeamMap>;
export function summarizeTeamMap(teamMap: TeamMap): Record<string, { mapped: number; unmapped: number }>;
