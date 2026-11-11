// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIXTURES } from "./fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MediaWikiClient,
  type MediaWikiClientOptions,
  OfflineCacheMissError,
  RequestBudgetExceededError,
  USER_AGENT,
  cacheKey,
  formatStats,
} from "../../../scripts/world/lib/mediawiki-client.mjs";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("MediaWikiClient", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mw-client-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  type FetchImpl = NonNullable<MediaWikiClientOptions["fetchImpl"]>;
  const make = (fetchImpl: FetchImpl, extra: Partial<MediaWikiClientOptions> = {}) =>
    new MediaWikiClient({ cacheDir: dir, throttleMs: 0, sleep: async () => {}, fetchImpl, ...extra });

  it("keeps cache keys compatible with the recorded Python spike cache", () => {
    // The fixture cache was recorded by the spike under Python's key scheme.
    const recorded = path.join(FIXTURES.cacheDir, `${cacheKey({ action: "parse", page: "Team Vitality", prop: "sections" })}.json`);
    expect(fs.existsSync(recorded)).toBe(true);
    expect(cacheKey({ page: "T1", action: "parse", prop: "sections", maxlag: "5" })).toBe(
      cacheKey({ action: "parse", page: "T1", prop: "sections" }),
    );
  });

  it("sends the generic user agent, maxlag and caches successful answers", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: { headers: Record<string, string> }) => json({ parse: { title: "T1" } }));
    const client = make(fetchImpl);
    await client.get({ action: "parse", page: "T1", prop: "sections" });
    await client.get({ action: "parse", page: "T1", prop: "sections" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.headers["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toBe("OLManager-research/0.1 (roster refresh tool)");
    expect(new URL(url).searchParams.get("maxlag")).toBe("5");
    expect(client.stats).toMatchObject({ network: 1, cacheHits: 1 });
  });

  it("retries 429 and ratelimited errors with backoff, then succeeds", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(json({}, { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(json({ error: { code: "ratelimited", info: "slow down" } }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = make(fetchImpl, { sleep });
    await expect(client.get({ action: "query", titles: "A" })).resolves.toEqual({ ok: true });
    expect(client.stats.retries).toBe(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  describe("retry diagnostics", () => {
    const params = { action: "query", titles: "A" };

    it("records an HTTP 429 once and logs one retry with the backoff delay", async () => {
      const log = vi.fn();
      const fetchImpl = vi
        .fn<FetchImpl>()
        .mockResolvedValueOnce(json({}, { status: 429 }))
        .mockResolvedValueOnce(json({ ok: true }));
      const client = make(fetchImpl, { throttleMs: 1000, log });
      await client.get(params);
      expect(client.stats.retryReasons).toEqual({ "HTTP 429": 1 });
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("attempt 1/5 failed: HTTP 429; retrying in 2000 ms", {
        attempt: 1,
        maxAttempts: 5,
        reason: "HTTP 429",
        delayMs: 2000,
      });
    });

    it("counts a retryable API error under api:<code>", async () => {
      const fetchImpl = vi
        .fn<FetchImpl>()
        .mockResolvedValueOnce(json({ error: { code: "ratelimited", info: "slow down" } }))
        .mockResolvedValueOnce(json({ ok: true }));
      const client = make(fetchImpl);
      await client.get(params);
      expect(client.stats.retryReasons).toEqual({ "api:ratelimited": 1 });
    });

    it("counts a thrown timeout by its name", async () => {
      const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      const fetchImpl = vi.fn<FetchImpl>().mockRejectedValueOnce(timeout).mockResolvedValueOnce(json({ ok: true }));
      const client = make(fetchImpl);
      await client.get(params);
      expect(client.stats.retryReasons).toEqual({ TimeoutError: 1 });
    });

    it("keeps a network failure code but never a URL", async () => {
      const failure = Object.assign(new TypeError("fetch failed: https://lol.fandom.com/api.php?lgpassword=x"), {
        cause: { code: "ECONNRESET" },
      });
      const fetchImpl = vi.fn<FetchImpl>().mockRejectedValueOnce(failure).mockResolvedValueOnce(json({ ok: true }));
      const client = make(fetchImpl);
      await client.get(params);
      expect(Object.keys(client.stats.retryReasons)).toEqual(["TypeError: fetch failed: (ECONNRESET)"]);
    });

    it("attaches a stats snapshot to the final retry error and tells the log it gives up", async () => {
      const log = vi.fn();
      const client = make(vi.fn(async () => json({}, { status: 503 })), { maxRetries: 1, log });
      const error = await client.get(params).catch((e) => e);
      expect(error.message).toBe("HTTP 503");
      expect(error.stats).toEqual({ network: 2, cacheHits: 0, retries: 1, retryReasons: { "HTTP 503": 2 } });
      expect(log).toHaveBeenLastCalledWith("attempt 2/2 failed: HTTP 503; giving up", expect.objectContaining({ delayMs: undefined }));
      expect(formatStats(error.stats)).toBe("2 live, 0 cached, 1 retries (HTTP 503: 2)");
    });

    it("attaches a stats snapshot when the request budget is exhausted", async () => {
      const client = make(vi.fn(async () => json({ ok: true })), { maxRequests: 1 });
      await client.get({ action: "query", titles: "A" });
      const error = await client.get({ action: "query", titles: "B" }).catch((e) => e);
      expect(error).toBeInstanceOf(RequestBudgetExceededError);
      expect(error.stats).toEqual({ network: 1, cacheHits: 0, retries: 0, retryReasons: {} });
    });

    it("stays silent by default", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchImpl = vi.fn<FetchImpl>().mockResolvedValueOnce(json({}, { status: 429 })).mockResolvedValueOnce(json({ ok: true }));
      await make(fetchImpl).get(params);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it("gives up after the bounded attempts and does not cache failures", async () => {
    const fetchImpl = vi.fn(async () => json({}, { status: 503 }));
    const client = make(fetchImpl, { maxRetries: 2 });
    await expect(client.get({ action: "query", titles: "A" })).rejects.toThrow(/HTTP 503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  it("does not retry API errors that are not transient", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: "missingtitle", info: "nope" } }));
    const client = make(fetchImpl);
    await expect(client.get({ action: "parse", page: "Nope" })).rejects.toThrow(/missingtitle/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the request budget", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const client = make(fetchImpl, { maxRequests: 1 });
    await client.get({ action: "query", titles: "A" });
    await expect(client.get({ action: "query", titles: "B" })).rejects.toBeInstanceOf(RequestBudgetExceededError);
  });

  it("offline mode serves the cache and fails clearly on a miss without touching the network", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const online = make(fetchImpl);
    await online.get({ action: "query", titles: "A" });

    const offline = make(fetchImpl, { offline: true });
    await expect(offline.get({ action: "query", titles: "A" })).resolves.toEqual({ ok: true });
    await expect(offline.get({ action: "query", titles: "B" })).rejects.toBeInstanceOf(OfflineCacheMissError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throttles consecutive live requests", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const client = new MediaWikiClient({
      cacheDir: dir,
      throttleMs: 4000,
      sleep,
      fetchImpl: vi.fn(async () => json({ ok: true })),
    });
    await client.get({ action: "query", titles: "A" });
    await client.get({ action: "query", titles: "B" });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(3000);
  });

  describe("cache freshness", () => {
    const DAY = 86_400_000;
    const NOW = Date.parse("2026-11-07T12:00:00Z");
    const query = { action: "query", titles: "A" };
    const fresh = (fetchImpl: FetchImpl, extra: Partial<MediaWikiClientOptions> = {}) => make(fetchImpl, { now: () => NOW, ...extra });

    it("stamps each stored entry with its fetch time and hides the stamp from callers", async () => {
      const client = fresh(vi.fn(async () => json({ ok: true })));
      await expect(client.get(query)).resolves.toEqual({ ok: true });
      const stored = JSON.parse(fs.readFileSync(client.cachePath(query), "utf8"));
      expect(stored.__fetchedAt).toBe("2026-11-07T12:00:00.000Z");
      await expect(fresh(vi.fn(), { offline: true }).get(query)).resolves.toEqual({ ok: true });
    });

    it("re-fetches a live entry older than --max-cache-age-days and keeps a younger one", async () => {
      const fetchImpl = vi.fn(async () => json({ ok: "new" }));
      await fresh(vi.fn(async () => json({ ok: "old" }))).get(query);

      const eightDaysLater = make(fetchImpl, { now: () => NOW + 8 * DAY, maxCacheAgeDays: 7 });
      await expect(eightDaysLater.get(query)).resolves.toEqual({ ok: "new" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const twoDaysLater = make(fetchImpl, { now: () => NOW + 10 * DAY, maxCacheAgeDays: 7 });
      await expect(twoDaysLater.get(query)).resolves.toEqual({ ok: "new" }); // re-stored at NOW + 8d, only 2d old
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("treats an entry without a stamp as fetched at the file mtime", async () => {
      const client = fresh(vi.fn(async () => json({ ok: "new" })));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(client.cachePath(query), JSON.stringify({ ok: "legacy" }));
      const tenDaysAgo = new Date(NOW - 10 * DAY);
      fs.utimesSync(client.cachePath(query), tenDaysAgo, tenDaysAgo);

      expect(client.readCacheEntry(query)).toMatchObject({ data: { ok: "legacy" }, fetchedAt: tenDaysAgo.getTime() });
      await expect(client.get(query)).resolves.toEqual({ ok: "new" });
    });

    it("offline mode reads an entry of any age", async () => {
      const writer = fresh(vi.fn(async () => json({ ok: "old" })));
      await writer.get(query);
      const offline = make(vi.fn(), { offline: true, now: () => NOW + 400 * DAY, maxCacheAgeDays: 7 });
      await expect(offline.get(query)).resolves.toEqual({ ok: "old" });
      expect(offline.oldestFetchDate()).toBe("2026-11-07");
    });

    it("reports the oldest fetch date among the entries it used", async () => {
      const client = fresh(vi.fn(async () => json({ ok: true })));
      expect(client.oldestFetchDate()).toBeNull();
      const other = { action: "query", titles: "B" };
      // A legacy (unstamped) entry whose mtime is three days old.
      const aged = new Date(NOW - 3 * DAY);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(client.cachePath(other), JSON.stringify({ ok: true }));
      fs.utimesSync(client.cachePath(other), aged, aged);

      await client.get(query);
      await client.get({ action: "query", titles: "B" });
      expect(client.oldestFetchDate()).toBe("2026-11-04");
    });
  });
});
