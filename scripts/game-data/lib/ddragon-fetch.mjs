// Polite, cached, read-only GET client for Riot's Data Dragon CDN. One host, one request at a time.
//
// Downloads are untrusted data: JSON is parsed and never evaluated, images must start with the PNG signature,
// and nothing is followed to another host (redirects are errors). Every response is cached on disk by path.
import fs from "node:fs";
import path from "node:path";

export const DDRAGON_HOST = "ddragon.leagueoflegends.com";
/** Generic client name: no person, machine or path in it. */
export const USER_AGENT = "OLManager-research/0.1 (static data refresh tool)";
export const DEFAULT_THROTTLE_MS = 1000;
export const VERSIONS_MAX_AGE_MS = 86_400_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const INDEX_FILE = ".fetched-at.json";
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class OfflineCacheMissError extends Error {
  constructor(relPath) {
    super(`offline mode: no cached copy of ${relPath}`);
    this.name = "OfflineCacheMissError";
  }
}

export class RequestBudgetExceededError extends Error {
  constructor(limit) {
    super(`request budget exhausted (--max-requests ${limit})`);
    this.name = "RequestBudgetExceededError";
  }
}

export class DdragonHttpError extends Error {
  constructor(relPath, status) {
    super(`HTTP ${status} for ${relPath}`);
    this.name = "DdragonHttpError";
    this.status = status;
  }
}

/** Throws unless the path is a plain relative path with no `..`, scheme, query or host part. */
export function assertSafeRelPath(relPath) {
  if (typeof relPath !== "string" || !SAFE_PATH.test(relPath) || relPath.split("/").includes("..") || relPath.includes("//")) {
    throw new Error(`unsafe Data Dragon path ${JSON.stringify(relPath)}`);
  }
}

export function isPng(buffer) {
  return buffer.length > PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

export class DdragonClient {
  /**
   * @param {object} options
   * @param {string} options.cacheDir
   * @param {boolean} [options.offline] read the cache only; a miss is an error
   * @param {number} [options.throttleMs] minimum gap between live requests
   * @param {number} [options.maxRequests] cap on live HTTP attempts
   * @param {number} [options.maxRetries] extra attempts after a 429 or 5xx (default 2)
   * @param {(url: string, init: object) => Promise<Response>} [options.fetchImpl]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {() => number} [options.now]
   * @param {(message: string) => void} [options.log]
   */
  constructor(options) {
    this.cacheDir = options.cacheDir;
    this.offline = options.offline ?? false;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.maxRequests = options.maxRequests ?? Number.POSITIVE_INFINITY;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => {});
    this.stats = { network: 0, cacheHits: 0, retries: 0, failures: {} };
    this.lastRequestAt = 0;
  }

  cachePath(relPath) {
    assertSafeRelPath(relPath);
    return path.join(this.cacheDir, relPath);
  }

  readIndex() {
    const file = path.join(this.cacheDir, INDEX_FILE);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  }

  /** ISO date (UTC, `YYYY-MM-DD`) on which a cached path was first downloaded, or null. */
  fetchedDate(relPath) {
    const stamp = this.readIndex()[relPath];
    return typeof stamp === "string" ? stamp.slice(0, 10) : null;
  }

  stamp(relPath, { replace }) {
    const index = this.readIndex();
    if (replace || !index[relPath]) index[relPath] = new Date(this.now()).toISOString();
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(path.join(this.cacheDir, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  }

  /** Bytes of a path: from the cache when present (and fresh enough), else one live GET. */
  async bytes(relPath, { maxAgeMs = Number.POSITIVE_INFINITY, validate } = {}) {
    const file = this.cachePath(relPath);
    const cached = fs.existsSync(file);
    const stale = cached && !this.offline && this.now() - fs.statSync(file).mtimeMs > maxAgeMs;
    if (cached && !stale) {
      this.stats.cacheHits += 1;
      return fs.readFileSync(file);
    }
    if (this.offline) throw new OfflineCacheMissError(relPath);
    const body = await this.fetchWithRetry(relPath);
    if (validate && !validate(body)) throw new Error(`unexpected content for ${relPath}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    this.stamp(relPath, { replace: stale });
    return body;
  }

  async json(relPath, options = {}) {
    const body = await this.bytes(relPath, options);
    return JSON.parse(body.toString("utf8"));
  }

  async png(relPath) {
    return this.bytes(relPath, { validate: isPng });
  }

  async fetchWithRetry(relPath) {
    const url = `https://${DDRAGON_HOST}/${relPath}`;
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (this.stats.network >= this.maxRequests) throw new RequestBudgetExceededError(this.maxRequests);
      const wait = this.lastRequestAt + this.throttleMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
      this.stats.network += 1;
      let retryable = false;
      try {
        const response = await this.fetchImpl(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
          redirect: "error",
          signal: AbortSignal.timeout(40_000),
        });
        if (response.ok) return Buffer.from(await response.arrayBuffer());
        retryable = response.status === 429 || response.status >= 500;
        lastError = new DdragonHttpError(relPath, response.status);
        this.stats.failures[`HTTP ${response.status}`] = (this.stats.failures[`HTTP ${response.status}`] ?? 0) + 1;
      } catch (error) {
        retryable = true;
        lastError = error;
        const reason = error?.name ?? "Error";
        this.stats.failures[reason] = (this.stats.failures[reason] ?? 0) + 1;
      }
      if (!retryable || attempt === this.maxRetries) break;
      this.stats.retries += 1;
      const delay = this.throttleMs * 2 ** (attempt + 1);
      this.log(`attempt ${attempt + 1} failed; retrying in ${delay} ms`);
      await this.sleep(delay);
    }
    throw lastError;
  }
}

export function formatStats(stats) {
  const failures = Object.entries(stats.failures).map(([reason, count]) => `${reason}: ${count}`).join(", ");
  return `${stats.network} live, ${stats.cacheHits} cached, ${stats.retries} retries${failures ? ` (${failures})` : ""}`;
}
