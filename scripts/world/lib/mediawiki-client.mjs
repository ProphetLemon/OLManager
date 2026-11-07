// Minimal cached MediaWiki API client for lol.fandom.com (plain api.php, no Cargo).
// Etiquette: generic User-Agent without personal data, throttled, maxlag, bounded retries,
// on-disk cache, and a hard cap on live requests.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const USER_AGENT = "OLManager-research/0.1 (roster refresh tool)";
export const DEFAULT_API_URL = "https://lol.fandom.com/api.php";
export const DEFAULT_THROTTLE_MS = 4000;
export const DEFAULT_MAX_LAG = 5;

/** Params that influence server behaviour but not the answer; excluded from the cache key. */
const NON_KEY_PARAMS = new Set(["maxlag"]);
const RETRYABLE_API_ERRORS = new Set(["ratelimited", "maxlag", "readonly", "internal_api_error_DBConnectionError"]);

export class OfflineCacheMissError extends Error {
  constructor(params) {
    super(`offline mode: no cached response for ${JSON.stringify(params)}`);
    this.name = "OfflineCacheMissError";
    this.params = params;
  }
}

export class RequestBudgetExceededError extends Error {
  constructor(limit) {
    super(`request budget exhausted (--max-requests ${limit})`);
    this.name = "RequestBudgetExceededError";
  }
}

export class MediaWikiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MediaWikiError";
    Object.assign(this, details);
  }
}

/** Python `json.dumps(obj, sort_keys=True)` for a flat string map, so existing recorded caches stay valid. */
function pythonJsonDumps(map) {
  const esc = (s) =>
    JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const body = Object.keys(map)
    .sort()
    .map((k) => `${esc(k)}: ${esc(String(map[k]))}`)
    .join(", ");
  return `{${body}}`;
}

export function cacheKey(params) {
  const keyed = { format: "json" };
  for (const [k, v] of Object.entries(params)) if (!NON_KEY_PARAMS.has(k)) keyed[k] = String(v);
  return createHash("sha1").update(pythonJsonDumps(keyed)).digest("hex").slice(0, 16);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MediaWikiClient {
  /**
   * @param {object} options
   * @param {string} options.cacheDir
   * @param {boolean} [options.offline] only read the cache, fail on a miss
   * @param {number} [options.throttleMs]
   * @param {number} [options.maxRequests] cap on live HTTP attempts
   * @param {number} [options.maxRetries] attempts after the first one
   * @param {(url: string, init: object) => Promise<Response>} [options.fetchImpl]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor(options) {
    this.apiUrl = options.apiUrl ?? DEFAULT_API_URL;
    this.cacheDir = options.cacheDir;
    this.offline = options.offline ?? false;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.maxRequests = options.maxRequests ?? Number.POSITIVE_INFINITY;
    this.maxRetries = options.maxRetries ?? 4;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.stats = { network: 0, cacheHits: 0, retries: 0 };
    this.lastRequestAt = 0;
  }

  cachePath(params) {
    return path.join(this.cacheDir, `${cacheKey(params)}.json`);
  }

  readCache(params) {
    const file = this.cachePath(params);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  writeCache(params, data) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(this.cachePath(params), JSON.stringify(data));
  }

  /** GET `api.php` with the given params. Cached on success; never caches API errors. */
  async get(params) {
    const cached = this.readCache(params);
    if (cached) {
      this.stats.cacheHits += 1;
      return cached;
    }
    if (this.offline) throw new OfflineCacheMissError(params);
    const data = await this.fetchWithRetry(params);
    this.writeCache(params, data);
    return data;
  }

  buildUrl(params) {
    const query = new URLSearchParams({ format: "json", maxlag: String(DEFAULT_MAX_LAG) });
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    return `${this.apiUrl}?${query.toString()}`;
  }

  async fetchWithRetry(params) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (this.stats.network >= this.maxRequests) throw new RequestBudgetExceededError(this.maxRequests);
      await this.waitForThrottle();
      this.stats.network += 1;
      let retryAfterMs = 0;
      try {
        const response = await this.fetchImpl(this.buildUrl(params), {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(40_000),
        });
        if (response.status === 429 || response.status >= 500) {
          retryAfterMs = Number(response.headers.get("retry-after") ?? 0) * 1000;
          lastError = new MediaWikiError(`HTTP ${response.status}`, { status: response.status });
        } else if (!response.ok) {
          throw new MediaWikiError(`HTTP ${response.status}`, { status: response.status, fatal: true });
        } else {
          const data = await response.json();
          if (!data.error) return data;
          lastError = new MediaWikiError(`API error ${data.error.code}: ${data.error.info}`, { code: data.error.code });
          if (!RETRYABLE_API_ERRORS.has(data.error.code)) throw Object.assign(lastError, { fatal: true });
          retryAfterMs = Number(response.headers.get("retry-after") ?? 0) * 1000;
        }
      } catch (error) {
        if (error?.fatal) throw error;
        lastError = error;
      }
      if (attempt < this.maxRetries) {
        this.stats.retries += 1;
        await this.sleep(Math.max(retryAfterMs, this.throttleMs * 2 ** (attempt + 1)));
      }
    }
    throw lastError ?? new MediaWikiError("request failed");
  }

  async waitForThrottle() {
    const wait = this.lastRequestAt + this.throttleMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = Date.now();
  }
}

// --- Typed helpers for the handful of requests the tool needs ----------------------------------

export const sectionsParams = (page) => ({ action: "parse", page, prop: "sections" });
export const sectionTextParams = (page, index) => ({
  action: "parse",
  page,
  section: String(index),
  prop: "text",
  disablelimitreport: "1",
});
export const wikitextParams = (title) => ({
  action: "query",
  prop: "revisions",
  rvprop: "content",
  rvslots: "main",
  titles: title,
  redirects: "1",
});
export const siteRightsParams = () => ({ action: "query", meta: "siteinfo", siprop: "rightsinfo" });
export const resolveTitlesParams = (titles) => ({
  action: "query",
  titles: titles.join("|"),
  redirects: "1",
  prop: "categories",
  clcategories: "Category:Teams",
  cllimit: "max",
});

/** Page wikitext after following redirects, or null when the page is missing. */
export async function fetchWikitext(client, title) {
  const data = await client.get(wikitextParams(title));
  const query = data.query ?? {};
  const redirects = Object.fromEntries((query.redirects ?? []).map((r) => [r.from, r.to]));
  const normalized = Object.fromEntries((query.normalized ?? []).map((r) => [r.from, r.to]));
  const normTitle = normalized[title] ?? title;
  const resolved = redirects[normTitle] ?? normTitle;
  const page = Object.values(query.pages ?? {}).find((p) => p.title === resolved);
  const revision = page?.revisions?.[0];
  return { title: resolved, wikitext: revision ? revision.slots.main["*"] : null };
}

export async function fetchSections(client, title) {
  const data = await client.get(sectionsParams(title));
  return data.parse?.sections ?? [];
}

export async function fetchSectionHtml(client, title, index) {
  const data = await client.get(sectionTextParams(title, index));
  return data.parse?.text?.["*"] ?? "";
}

export async function fetchRights(client) {
  const data = await client.get(siteRightsParams());
  const rights = data.query?.rightsinfo ?? {};
  return { text: rights.text ?? "", url: rights.url ?? "" };
}

/**
 * Resolve a batch (<= 50) of titles to canonical page titles.
 * Returns Map(requested -> {title, missing, redirected, isTeam}); `isTeam` means the page is in Category:Teams,
 * which excludes disambiguation and player pages that share a team's name.
 */
export async function resolveTitles(client, titles) {
  const data = await client.get(resolveTitlesParams(titles));
  const query = data.query ?? {};
  const normalized = Object.fromEntries((query.normalized ?? []).map((r) => [r.from, r.to]));
  const redirects = Object.fromEntries((query.redirects ?? []).map((r) => [r.from, r.to]));
  const pages = new Map(Object.values(query.pages ?? {}).map((p) => [p.title, p]));
  const out = new Map();
  for (const requested of titles) {
    const normTitle = normalized[requested] ?? requested;
    const resolved = redirects[normTitle] ?? normTitle;
    const page = pages.get(resolved);
    const missing = !page || "missing" in page;
    const isTeam = !missing && (page.categories ?? []).some((c) => c.title === "Category:Teams");
    out.set(requested, { title: resolved, missing, redirected: resolved !== normTitle, isTeam });
  }
  return out;
}
