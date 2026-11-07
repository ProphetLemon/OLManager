export const USER_AGENT: string;
export const DEFAULT_API_URL: string;
export const DEFAULT_THROTTLE_MS: number;
export const DEFAULT_MAX_LAG: number;
export const DEFAULT_MAX_CACHE_AGE_DAYS: number;

export class OfflineCacheMissError extends Error {
  params: Record<string, string>;
}
export class RequestBudgetExceededError extends Error {}
export class MediaWikiError extends Error {
  status?: number;
  code?: string;
}

export interface MediaWikiClientOptions {
  cacheDir: string;
  apiUrl?: string;
  offline?: boolean;
  throttleMs?: number;
  maxRequests?: number;
  maxRetries?: number;
  fetchImpl?: (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  maxCacheAgeDays?: number;
  now?: () => number;
}
export interface ClientStats {
  network: number;
  cacheHits: number;
  retries: number;
}

export function cacheKey(params: Record<string, string>): string;

export class MediaWikiClient {
  constructor(options: MediaWikiClientOptions);
  stats: ClientStats;
  offline: boolean;
  cachePath(params: Record<string, string>): string;
  maxCacheAgeDays: number;
  readCacheEntry(params: Record<string, string>): { data: any; fetchedAt: number } | null;
  readCache(params: Record<string, string>): unknown;
  writeCache(params: Record<string, string>, data: unknown, fetchedAt?: number): void;
  oldestFetchDate(): string | null;
  get(params: Record<string, string>): Promise<any>;
  buildUrl(params: Record<string, string>): string;
}

export function fetchWikitext(client: MediaWikiClient, title: string): Promise<{ title: string; wikitext: string | null }>;
export function fetchSections(client: MediaWikiClient, title: string): Promise<any[]>;
export function fetchSectionHtml(client: MediaWikiClient, title: string, index: string | number): Promise<string>;
export function fetchRights(client: MediaWikiClient): Promise<{ text: string; url: string }>;
export function resolveTitles(
  client: MediaWikiClient,
  titles: string[],
): Promise<Map<string, { title: string; missing: boolean; redirected: boolean; isTeam: boolean }>>;
