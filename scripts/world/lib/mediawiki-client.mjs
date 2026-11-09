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
export const DEFAULT_MAX_CACHE_AGE_DAYS = 7;

/** Key added to a cache entry next to the API answer; entries recorded without it fall back to the file mtime. */
const FETCHED_AT_KEY = "__fetchedAt";
const DAY_MS = 86_400_000;

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

/**
 * Short, secret-free reason for a thrown request error: the error name, plus the message for a bare
 * TypeError ("fetch failed") and the network error code when present. URLs are never included.
 */
export function describeThrown(error) {
  const name = typeof error?.name === "string" && error.name ? error.name : "Error";
  const parts = [name];
  if (name === "TypeError" && typeof error?.message === "string") {
    const message = error.message.replace(/\S*:\/\/\S*/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (message) parts[0] = `${name}: ${message}`;
  }
  const code = error?.cause?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)) parts.push(`(${code})`);
  return parts.join(" ");
}

/** One-line summary of client stats, e.g. `800 live, 12 cached, 285 retries (HTTP 429: 200, api:maxlag: 85)`. */
export function formatStats(stats) {
  const reasons = Object.entries(stats.retryReasons ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(", ");
  return `${stats.network} live, ${stats.cacheHits} cached, ${stats.retries} retries${reasons ? ` (${reasons})` : ""}`;
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

const LOGIN_HOST = "lol.fandom.com";

/** Credentials only ever go to https://lol.fandom.com. */
function assertLoginTarget(apiUrl) {
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new MediaWikiError("refusing to log in: the API URL is not a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== LOGIN_HOST) {
    throw new MediaWikiError(`refusing to send credentials: login is only allowed over https to ${LOGIN_HOST}`);
  }
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
   * @param {number} [options.maxCacheAgeDays] live runs re-fetch cache entries older than this
   * @param {() => number} [options.now] clock in ms, injectable for tests
   * @param {(message: string, event: object) => void} [options.log] told about every failed attempt (reason, attempt, delay); silent by default
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
    this.maxCacheAgeDays = options.maxCacheAgeDays ?? DEFAULT_MAX_CACHE_AGE_DAYS;
    this.now = options.now ?? (() => Date.now());
    /** Fetch time (ms) of every cache entry used by this run, by cache key. */
    this.fetchedAt = new Map();
    this.log = options.log ?? (() => {});
    this.stats = { network: 0, cacheHits: 0, retries: 0, retryReasons: {} };
    this.lastRequestAt = 0;
    /** In-memory cookie jar (name -> value). Never written to disk. */
    this.cookies = new Map();
    this.loggedIn = false;
  }

  /** Copy of the counters, safe to keep after the run throws. */
  statsSnapshot() {
    return { ...this.stats, retryReasons: { ...this.stats.retryReasons } };
  }

  /** Attach the stats snapshot to an error on its way out; returns the same error. */
  withStats(error) {
    if (error && typeof error === "object") error.stats = this.statsSnapshot();
    return error;
  }

  /** Count a failed attempt under its reason and tell `options.log`. Never receives URLs, params or credentials. */
  recordFailure(reason, attempt, maxAttempts, delayMs) {
    this.stats.retryReasons[reason] = (this.stats.retryReasons[reason] ?? 0) + 1;
    const next = delayMs === undefined ? "giving up" : `retrying in ${delayMs} ms`;
    this.log(`attempt ${attempt}/${maxAttempts} failed: ${reason}; ${next}`, { attempt, maxAttempts, reason, delayMs });
  }

  storeCookies(response) {
    for (const line of response.headers?.getSetCookie?.() ?? []) {
      const pair = line.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  requestHeaders(extra = {}) {
    const headers = { "User-Agent": USER_AGENT, Accept: "application/json", ...extra };
    if (this.cookies.size > 0) headers.Cookie = this.cookieHeader();
    return headers;
  }

  /** One uncached login-flow request: same throttle, budget and User-Agent as ordinary ones. */
  async loginRequest(url, init) {
    if (this.stats.network >= this.maxRequests) throw this.withStats(new RequestBudgetExceededError(this.maxRequests));
    await this.waitForThrottle();
    this.stats.network += 1;
    let response;
    try {
      response = await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(40_000) });
    } catch (error) {
      this.recordFailure(describeThrown(error), 1, 1);
      throw this.withStats(error);
    }
    this.storeCookies(response);
    if (!response.ok) {
      const reason = `HTTP ${response.status}`;
      this.recordFailure(reason, 1, 1);
      throw this.withStats(new MediaWikiError(`login request failed: ${reason}`, { status: response.status }));
    }
    return response.json();
  }

  /**
   * Opt-in bot-password login (https://www.mediawiki.org/wiki/API:Login). Login requests are never cached.
   * Errors carry login.result and login.reason only, never the password, token or cookies.
   */
  async login({ user, password }) {
    if (this.offline) return false;
    assertLoginTarget(this.apiUrl);
    try {
      return await this.performLogin(user, password);
    } catch (error) {
      this.cookies.clear();
      throw error;
    }
  }

  async performLogin(user, password) {
    const tokenQuery = new URLSearchParams({ action: "query", meta: "tokens", type: "login", format: "json" });
    const tokenData = await this.loginRequest(`${this.apiUrl}?${tokenQuery}`, { headers: this.requestHeaders() });
    const token = tokenData?.query?.tokens?.logintoken;
    if (!token) throw new MediaWikiError("login failed: the wiki returned no login token");
    const body = new URLSearchParams({ action: "login", lgname: user, lgpassword: password, lgtoken: token, format: "json" });
    const data = await this.loginRequest(this.apiUrl, {
      method: "POST",
      headers: this.requestHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: body.toString(),
    });
    const result = data?.login?.result;
    if (result !== "Success") {
      const reason = data?.login?.reason;
      throw new MediaWikiError(`login failed: ${result ?? "no result"}${reason ? ` (${reason})` : ""}`, { result, reason });
    }
    this.loggedIn = true;
    return true;
  }

  cachePath(params) {
    return path.join(this.cacheDir, `${cacheKey(params)}.json`);
  }

  /** Cached answer plus the time it was fetched, or null when there is no entry. */
  readCacheEntry(params) {
    const file = this.cachePath(params);
    if (!fs.existsSync(file)) return null;
    const { [FETCHED_AT_KEY]: stamp, ...data } = JSON.parse(fs.readFileSync(file, "utf8"));
    const stamped = stamp === undefined ? Number.NaN : Date.parse(stamp);
    return { data, fetchedAt: Number.isNaN(stamped) ? fs.statSync(file).mtimeMs : stamped };
  }

  readCache(params) {
    return this.readCacheEntry(params)?.data ?? null;
  }

  writeCache(params, data, fetchedAt = this.now()) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(this.cachePath(params), JSON.stringify({ ...data, [FETCHED_AT_KEY]: new Date(fetchedAt).toISOString() }));
  }

  /** GET `api.php` with the given params. Cached on success; never caches API errors. */
  async get(params) {
    const key = cacheKey(params);
    const cached = this.readCacheEntry(params);
    const stale = cached && !this.offline && this.now() - cached.fetchedAt > this.maxCacheAgeDays * DAY_MS;
    if (cached && !stale) {
      this.stats.cacheHits += 1;
      this.fetchedAt.set(key, cached.fetchedAt);
      return cached.data;
    }
    if (this.offline) throw new OfflineCacheMissError(params);
    const data = await this.fetchWithRetry(params);
    const fetchedAt = this.now();
    this.writeCache(params, data, fetchedAt);
    this.fetchedAt.set(key, fetchedAt);
    return data;
  }

  /** Date (`YYYY-MM-DD`, UTC) of the oldest cache entry used so far, or null when none was used. */
  oldestFetchDate() {
    if (this.fetchedAt.size === 0) return null;
    return new Date(Math.min(...this.fetchedAt.values())).toISOString().slice(0, 10);
  }

  buildUrl(params) {
    const query = new URLSearchParams({ format: "json", maxlag: String(DEFAULT_MAX_LAG) });
    for (const [k, v] of Object.entries(params)) query.set(k, String(v));
    return `${this.apiUrl}?${query.toString()}`;
  }

  async fetchWithRetry(params) {
    let lastError;
    const maxAttempts = this.maxRetries + 1;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (this.stats.network >= this.maxRequests) throw this.withStats(new RequestBudgetExceededError(this.maxRequests));
      await this.waitForThrottle();
      this.stats.network += 1;
      let retryAfterMs = 0;
      let reason;
      let fatal = false;
      try {
        const response = await this.fetchImpl(this.buildUrl(params), {
          headers: this.requestHeaders(),
          signal: AbortSignal.timeout(40_000),
        });
        if (response.status === 429 || response.status >= 500) {
          retryAfterMs = Number(response.headers.get("retry-after") ?? 0) * 1000;
          reason = `HTTP ${response.status}`;
          lastError = new MediaWikiError(`HTTP ${response.status}`, { status: response.status });
        } else if (!response.ok) {
          reason = `HTTP ${response.status}`;
          fatal = true;
          lastError = new MediaWikiError(`HTTP ${response.status}`, { status: response.status });
        } else {
          const data = await response.json();
          if (!data.error) return data;
          reason = `api:${data.error.code}`;
          lastError = new MediaWikiError(`API error ${data.error.code}: ${data.error.info}`, { code: data.error.code });
          if (RETRYABLE_API_ERRORS.has(data.error.code)) retryAfterMs = Number(response.headers.get("retry-after") ?? 0) * 1000;
          else fatal = true;
        }
      } catch (error) {
        reason = describeThrown(error);
        lastError = error;
      }
      if (fatal) {
        this.recordFailure(reason, attempt + 1, maxAttempts);
        throw this.withStats(lastError);
      }
      if (attempt < this.maxRetries) {
        const delayMs = Math.max(retryAfterMs, this.throttleMs * 2 ** (attempt + 1));
        this.stats.retries += 1;
        this.recordFailure(reason, attempt + 1, maxAttempts, delayMs);
        await this.sleep(delayMs);
      } else {
        this.recordFailure(reason, attempt + 1, maxAttempts);
      }
    }
    throw this.withStats(lastError ?? new MediaWikiError("request failed"));
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
