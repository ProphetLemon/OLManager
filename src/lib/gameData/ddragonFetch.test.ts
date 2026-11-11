// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DdragonClient,
  DdragonHttpError,
  OfflineCacheMissError,
  RequestBudgetExceededError,
  USER_AGENT,
  assertSafeRelPath,
  isPng,
} from "../../../scripts/game-data/lib/ddragon-fetch.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("image")]);

let cacheDir: string;
beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ddragon-test-"));
});
afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

function reply(body: string | Buffer, status = 200) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), { status });
}

function makeClient(responses: Array<Response | Error>, extra: Record<string, unknown> = {}) {
  const calls: { url: string; init: { headers: Record<string, string>; redirect: string } }[] = [];
  const sleeps: number[] = [];
  const client = new DdragonClient({
    cacheDir,
    throttleMs: 1,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    fetchImpl: async (url: string, init: object) => {
      calls.push({ url, init: init as never });
      const next = responses.shift();
      if (!next) throw new Error("unexpected extra request");
      if (next instanceof Error) throw next;
      return next;
    },
    ...extra,
  });
  return { client, calls, sleeps };
}

describe("assertSafeRelPath", () => {
  it("accepts Data Dragon paths and refuses anything that could leave the host or the cache", () => {
    expect(() => assertSafeRelPath("cdn/16.22.1/data/en_US/item.json")).not.toThrow();
    for (const bad of ["../x.json", "cdn/../x", "/etc/passwd", "https://evil.example/x", "cdn//x", "a?b=1", "a b", ""]) {
      expect(() => assertSafeRelPath(bad), bad).toThrow(/unsafe/);
    }
  });
});

describe("isPng", () => {
  it("checks the signature", () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(Buffer.from("<html>not an image</html>"))).toBe(false);
  });
});

describe("DdragonClient", () => {
  it("requests the Data Dragon host only, with the generic client name and redirects refused", async () => {
    const { client, calls } = makeClient([reply('{"ok":1}')]);
    await client.json("cdn/16.22.1/data/en_US/item.json");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://ddragon.leagueoflegends.com/cdn/16.22.1/data/en_US/item.json");
    expect(calls[0].init.headers["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).not.toMatch(/@|\/home\/|\/Users\//);
    expect(calls[0].init.redirect).toBe("error");
  });

  it("reuses the cache on a second call and in offline mode, and stamps the first download date", async () => {
    const { client, calls } = makeClient([reply('{"v":1}')]);
    await client.json("api/versions.json", { maxAgeMs: 1e12 });
    await client.json("api/versions.json", { maxAgeMs: 1e12 });
    expect(calls).toHaveLength(1);
    expect(client.stats).toMatchObject({ network: 1, cacheHits: 1 });
    expect(client.fetchedDate("api/versions.json")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const offline = new DdragonClient({ cacheDir, offline: true });
    await expect(offline.json("api/versions.json")).resolves.toEqual({ v: 1 });
  });

  it("fails in offline mode on a cache miss without a request", async () => {
    const { client, calls } = makeClient([], { offline: true });
    await expect(client.json("cdn/1.1.1/data/en_US/item.json")).rejects.toBeInstanceOf(OfflineCacheMissError);
    expect(calls).toHaveLength(0);
  });

  it("refetches an entry older than maxAgeMs", async () => {
    let now = Date.now();
    const { client, calls } = makeClient([reply('{"v":1}'), reply('{"v":2}')], { now: () => now });
    await client.json("api/versions.json", { maxAgeMs: 1000 });
    const file = path.join(cacheDir, "api/versions.json");
    fs.utimesSync(file, new Date(now - 5000), new Date(now - 5000));
    now += 10;
    await expect(client.json("api/versions.json", { maxAgeMs: 1000 })).resolves.toEqual({ v: 2 });
    expect(calls).toHaveLength(2);
  });

  it("retries a 429 with a growing delay, then succeeds", async () => {
    const { client, calls, sleeps } = makeClient([reply("slow down", 429), reply('{"ok":true}')], { throttleMs: 100 });
    await expect(client.json("a/b.json")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(client.stats.retries).toBe(1);
    expect(sleeps).toContain(200);
  });

  it("stops after the retry limit instead of looping, and does not retry a 404", async () => {
    const failing = makeClient([reply("x", 503), reply("x", 503), reply("x", 503)]);
    await expect(failing.client.json("a/b.json")).rejects.toBeInstanceOf(DdragonHttpError);
    expect(failing.calls).toHaveLength(3);
    const missing = makeClient([reply("nope", 404)]);
    await expect(missing.client.json("a/c.json")).rejects.toMatchObject({ status: 404 });
    expect(missing.calls).toHaveLength(1);
  });

  it("enforces the request budget", async () => {
    const { client } = makeClient([reply("{}"), reply("{}")], { maxRequests: 1 });
    await client.json("a/1.json");
    await expect(client.json("a/2.json")).rejects.toBeInstanceOf(RequestBudgetExceededError);
  });

  it("does not cache a download that fails validation", async () => {
    const { client } = makeClient([reply("<html>blocked</html>")]);
    await expect(client.png("cdn/1.1.1/img/item/1.png")).rejects.toThrow(/unexpected content/);
    expect(fs.existsSync(path.join(cacheDir, "cdn/1.1.1/img/item/1.png"))).toBe(false);
  });

  it("stores a valid image byte for byte", async () => {
    const { client } = makeClient([reply(PNG)]);
    const body = await client.png("cdn/1.1.1/img/item/1.png");
    expect(body.equals(PNG)).toBe(true);
    expect(fs.readFileSync(path.join(cacheDir, "cdn/1.1.1/img/item/1.png")).equals(PNG)).toBe(true);
  });
});
