export const DDRAGON_HOST: string;
export const USER_AGENT: string;
export const DEFAULT_THROTTLE_MS: number;
export const VERSIONS_MAX_AGE_MS: number;

export class OfflineCacheMissError extends Error {}
export class RequestBudgetExceededError extends Error {}
export class DdragonHttpError extends Error {
  status: number;
}

export interface DdragonClientOptions {
  cacheDir: string;
  offline?: boolean;
  throttleMs?: number;
  maxRequests?: number;
  maxRetries?: number;
  fetchImpl?: (url: string, init: object) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}
export interface DdragonStats {
  network: number;
  cacheHits: number;
  retries: number;
  failures: Record<string, number>;
}

export function assertSafeRelPath(relPath: string): void;
export function isPng(buffer: Buffer): boolean;
export function formatStats(stats: DdragonStats): string;
export class DdragonClient {
  constructor(options: DdragonClientOptions);
  stats: DdragonStats;
  fetchedDate(relPath: string): string | null;
  bytes(relPath: string, options?: { maxAgeMs?: number; validate?: (body: Buffer) => boolean }): Promise<Buffer>;
  json(relPath: string, options?: { maxAgeMs?: number }): Promise<unknown>;
  png(relPath: string): Promise<Buffer>;
}
