import type { MediaWikiClient } from "./mediawiki-client.mjs";

export type PlayerStatus =
  | { found: false }
  | { found: true; title: string; isRetired: boolean; state: string | null; teamText: string | null; teamName: string | null; birthDate: string | null };
export function lookupPlayerStatus(client: MediaWikiClient, player: { match_name: string; full_name: string }): Promise<PlayerStatus>;
export function lookupInfobox(client: MediaWikiClient, page: string): Promise<Record<string, any> | null>;
