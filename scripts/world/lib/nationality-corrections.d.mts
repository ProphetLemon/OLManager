export const CONFIRMED_TIERS: readonly string[];

/** [tier, id, in-game name, real name, country, rows with that ID], as saved by the Leaguepedia join. */
export type JoinDetail = [string, string, string, string, string, number];

export interface LeaguepediaRow {
  ID: string;
  Name: string;
  Country: string;
  NationalityPrimary?: string;
}

export interface ShippedPlayer {
  id: string;
  match_name: string;
  full_name: string;
  nationality: string;
  team_id: string | null;
  shard: string;
}

export interface CatalogCorrection {
  id: string;
  field: string;
  from: string;
  to: string;
  evidence: string;
}

export interface WrittenCorrection {
  id: string;
  match_name: string;
  full_name: string;
  leaguepedia_name: string;
  country: string;
  iso: string;
  tier: string;
  team_id: string | null;
  entry: CatalogCorrection;
}

export interface NationalityCorrectionsResult {
  entries: CatalogCorrection[];
  report: {
    perTier: Record<string, number>;
    skipped: Array<{ id: string; name: string; tier: string; reason: string }>;
    written: WrittenCorrection[];
  };
}

export function evidenceUrl(leaguepediaId: string, queried: string): string;
export function mergeCorrections(existing: CatalogCorrection[], added: CatalogCorrection[]): CatalogCorrection[];
export function buildNationalityCorrections(input: {
  detail: JoinDetail[];
  rows: LeaguepediaRow[];
  players: ShippedPlayer[];
  existing?: Array<CatalogCorrection | Record<string, string>>;
  queried: string;
}): NationalityCorrectionsResult;
export function reviewListMarkdown(result: Pick<NationalityCorrectionsResult, "report">): string;
