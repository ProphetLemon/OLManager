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
});
