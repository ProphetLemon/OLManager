export const USER_AGENT: string;
export const DEFAULT_API_URL: string;
export const DEFAULT_THROTTLE_MS: number;
export const DEFAULT_MAX_LAG: number;
export const DEFAULT_MAX_CACHE_AGE_DAYS: number;

export class OfflineCacheMissError extends Error {
  constructor(params: Record<string, string>);
  params: Record<string, string>;
}
export class RequestBudgetExceededError extends Error {
  stats?: ClientStats;
}
export class MediaWikiError extends Error {
  status?: number;
  code?: string;
  /** Snapshot of the client counters taken when the error was thrown. */
  stats?: ClientStats;
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
  /** Told about every failed attempt; silent by default. Never receives URLs, params or credentials. */
  log?: (message: string, event: RetryEvent) => void;
}
export interface RetryEvent {
  attempt: number;
  maxAttempts: number;
  reason: string;
  /** Wait before the next attempt in ms; undefined when the request gives up. */
  delayMs?: number;
}
export interface ClientStats {
  network: number;
  cacheHits: number;
  retries: number;
  /** Failed attempts by short reason: "HTTP 429", "api:ratelimited", "TimeoutError", ... */
  retryReasons: Record<string, number>;
}

export function describeThrown(error: unknown): string;
export function formatStats(stats: ClientStats): string;

export function cacheKey(params: Record<string, string>): string;

export class MediaWikiClient {
  constructor(options: MediaWikiClientOptions);
  stats: ClientStats;
  statsSnapshot(): ClientStats;
  offline: boolean;
  cachePath(params: Record<string, string>): string;
  maxCacheAgeDays: number;
  readCacheEntry(params: Record<string, string>): { data: any; fetchedAt: number } | null;
  readCache(params: Record<string, string>): unknown;
  writeCache(params: Record<string, string>, data: unknown, fetchedAt?: number): void;
  oldestFetchDate(): string | null;
  loggedIn: boolean;
  login(credentials: { user: string; password: string }): Promise<boolean>;
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
export function sectionsParams(page: string): Record<string, string>;
export function sectionTextParams(page: string, index: string | number): Record<string, string>;
export function wikitextParams(title: string): Record<string, string>;
export function siteRightsParams(): Record<string, string>;
export function resolveTitlesParams(titles: string[]): Record<string, string>;
