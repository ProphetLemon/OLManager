// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CredentialsError,
  loginFromFile,
  parseCredentialsText,
  readBotCredentials,
} from "../../../scripts/world/lib/bot-credentials.mjs";
import { MediaWikiClient, type MediaWikiClientOptions } from "../../../scripts/world/lib/mediawiki-client.mjs";

type FetchImpl = NonNullable<MediaWikiClientOptions["fetchImpl"]>;
type Init = { headers: Record<string, string>; method?: string; body?: string };
const PASSWORD = "s3cret-bot-password";
const creds = { user: "Alice@olmanager", password: PASSWORD };

const reply = (body: unknown, cookies: string[] = []) => {
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status: 200, headers });
};

describe("MediaWikiClient.login", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mw-login-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const make = (fetchImpl: FetchImpl, extra: Partial<MediaWikiClientOptions> = {}) =>
    new MediaWikiClient({ cacheDir: dir, throttleMs: 0, sleep: async () => {}, fetchImpl, ...extra });

  const loginFetch = (result: unknown = { result: "Success", lgusername: "Alice" }) =>
    vi
      .fn<(url: string, init: Init) => Promise<Response>>()
      .mockResolvedValueOnce(reply({ query: { tokens: { logintoken: "tok+\\" } } }, ["wikiSession=abc; Path=/; HttpOnly", "loginToken=t1; Path=/"]))
      .mockResolvedValueOnce(reply({ login: result }, ["wikiUserID=7; Path=/", "wikiSession=def; Path=/"]));

  it("fetches a login token by GET, then POSTs credentials in the body only", async () => {
    const fetchImpl = loginFetch();
    await expect(make(fetchImpl as unknown as FetchImpl).login(creds)).resolves.toBe(true);

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    const q = new URL(tokenUrl).searchParams;
    expect([q.get("action"), q.get("meta"), q.get("type"), q.get("format")]).toEqual(["query", "tokens", "login", "json"]);
    expect(tokenInit.method).toBeUndefined();

    const [postUrl, postInit] = fetchImpl.mock.calls[1];
    expect(postInit.method).toBe("POST");
    expect(postInit.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(postInit.body);
    expect(Object.fromEntries(body)).toEqual({
      action: "login",
      lgname: creds.user,
      lgpassword: PASSWORD,
      lgtoken: "tok+\\",
      format: "json",
    });
    expect(postUrl).not.toContain("?");
    expect(postUrl).not.toContain(PASSWORD);
    expect(postUrl).not.toContain("lgname");
  });

  it("forwards cookies from both responses on the login POST and on later get() calls", async () => {
    const fetchImpl = loginFetch();
    const client = make(fetchImpl as unknown as FetchImpl);
    await client.login(creds);
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBeUndefined();
    expect(fetchImpl.mock.calls[1][1].headers.Cookie).toBe("wikiSession=abc; loginToken=t1");

    fetchImpl.mockResolvedValueOnce(reply({ ok: true }));
    await client.get({ action: "query", titles: "A" });
    const cookie = fetchImpl.mock.calls[2][1].headers.Cookie;
    expect(cookie.split("; ").sort()).toEqual(["loginToken=t1", "wikiSession=def", "wikiUserID=7"]);
    expect(fetchImpl.mock.calls[2][1].headers["User-Agent"]).toMatch(/^OLManager-research/);
  });

  it("throws on a non-Success result with result and reason but without the password", async () => {
    const fetchImpl = loginFetch({ result: "Failed", reason: "Incorrect username or password entered." });
    const error = await make(fetchImpl as unknown as FetchImpl).login(creds).catch((e) => e);
    expect(error.name).toBe("MediaWikiError");
    expect(error.result).toBe("Failed");
    expect(error.reason).toMatch(/Incorrect/);
    expect(JSON.stringify([error.message, error.stack, { ...error }])).not.toContain(PASSWORD);
    expect(error.message).not.toContain("tok+");
    expect(error.message).not.toContain("wikiSession");
  });

  it.each(["http://lol.fandom.com/api.php", "https://example.com/api.php", "https://lol.fandom.com.evil.test/api.php", "https://evil.test/lol.fandom.com/api.php"])(
    "refuses to send credentials to %s before any fetch",
    async (apiUrl) => {
      const fetchImpl = vi.fn();
      await expect(make(fetchImpl as unknown as FetchImpl, { apiUrl }).login(creds)).rejects.toThrow(/refusing/);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("never reads or writes the cache for login requests", async () => {
    const fetchImpl = loginFetch();
    const client = make(fetchImpl as unknown as FetchImpl);
    const read = vi.spyOn(client, "readCacheEntry");
    const write = vi.spyOn(client, "writeCache");
    await client.login(creds);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(client.stats.network).toBe(2);
  });

  it("counts login requests against the request budget", async () => {
    const fetchImpl = loginFetch();
    await expect(make(fetchImpl as unknown as FetchImpl, { maxRequests: 1 }).login(creds)).rejects.toThrow(/budget/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary get() cache keys and requests unchanged when not logged in", async () => {
    const fetchImpl = vi.fn<(url: string, init: Init) => Promise<Response>>(async () => reply({ ok: true }));
    const client = make(fetchImpl as unknown as FetchImpl);
    await client.get({ action: "query", titles: "A" });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ "User-Agent": expect.any(String), Accept: "application/json" });
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it("does nothing in offline mode: no network and no credentials read", async () => {
    const fetchImpl = vi.fn();
    const log = vi.fn();
    const client = make(fetchImpl as unknown as FetchImpl, { offline: true });
    await expect(loginFromFile(client, { file: path.join(dir, "missing.env"), log })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/skipped/));
  });

  it("offline login with a non-fandom apiUrl returns without fetching or throwing", async () => {
    const fetchImpl = vi.fn();
    const client = make(fetchImpl as unknown as FetchImpl, { offline: true, apiUrl: "https://example.com/api.php" });
    await expect(client.login(creds)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clears the cookie jar when login fails, so a later get() sends no Cookie header", async () => {
    const fetchImpl = loginFetch({ result: "Failed", reason: "nope" });
    const client = make(fetchImpl as unknown as FetchImpl);
    await expect(client.login(creds)).rejects.toThrow(/login failed/);
    fetchImpl.mockResolvedValueOnce(reply({ ok: true }));
    await client.get({ action: "query", titles: "A" });
    expect(fetchImpl.mock.calls[2][1].headers.Cookie).toBeUndefined();
  });

  it("clears the jar when the token step fails with HTTP or network errors, and leaks no secrets in the message", async () => {
    const httpFetch = vi
      .fn<(url: string, init: Init) => Promise<Response>>()
      .mockResolvedValueOnce(reply({ query: { tokens: { logintoken: "tok" } } }, ["wikiSession=abc; Path=/"]))
      .mockResolvedValueOnce(new Response("x", { status: 500, headers: { "set-cookie": "wikiUserID=7; Path=/" } }));
    const httpClient = make(httpFetch as unknown as FetchImpl);
    const httpError = await httpClient.login(creds).catch((e) => e);
    expect(httpError.message).toMatch(/HTTP 500/);
    for (const secret of [PASSWORD, "abc", "wikiSession", "wikiUserID"]) expect(httpError.message).not.toContain(secret);
    expect((httpClient as unknown as { cookies: Map<string, string> }).cookies.size).toBe(0);

    const netFetch = vi
      .fn<(url: string, init: Init) => Promise<Response>>()
      .mockResolvedValueOnce(reply({ query: { tokens: { logintoken: "tok" } } }, ["wikiSession=abc; Path=/"]))
      .mockRejectedValueOnce(new Error("socket hang up"));
    const netClient = make(netFetch as unknown as FetchImpl);
    const netError = await netClient.login(creds).catch((e) => e);
    expect(netError.message).toBe("socket hang up");
    expect(JSON.stringify([netError.message, netError.stack])).not.toContain(PASSWORD);
    expect(netError.message).not.toContain("abc");
    expect((netClient as unknown as { cookies: Map<string, string> }).cookies.size).toBe(0);
  });

  it("logs a success line without the user name", async () => {
    const file = path.join(dir, "bot.env");
    fs.writeFileSync(file, `LEAGUEPEDIA_BOT_USER=${creds.user}\nLEAGUEPEDIA_BOT_PASSWORD=${PASSWORD}\n`, { mode: 0o600 });
    const log = vi.fn();
    await loginFromFile(make(loginFetch() as unknown as FetchImpl), { file, log });
    expect(log).toHaveBeenCalledWith("Logged in to Leaguepedia with a bot password");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Alice");
  });
});

describe("bot credentials file", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mw-creds-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (text: string, mode = 0o600) => {
    const file = path.join(dir, "bot.env");
    fs.writeFileSync(file, text);
    fs.chmodSync(file, mode);
    return file;
  };

  it("parses comments, blank lines and surrounding whitespace", () => {
    const text = "# comment\n\n  LEAGUEPEDIA_BOT_USER =  Alice@olmanager  \r\nLEAGUEPEDIA_BOT_PASSWORD=p=w d\n";
    expect(parseCredentialsText(text)).toEqual({ LEAGUEPEDIA_BOT_USER: "Alice@olmanager", LEAGUEPEDIA_BOT_PASSWORD: "p=w d" });
  });

  it("reads a 0600 file and refuses a 0644 one with a chmod hint", () => {
    const body = "LEAGUEPEDIA_BOT_USER=Alice@olmanager\nLEAGUEPEDIA_BOT_PASSWORD=pw\n";
    expect(readBotCredentials(write(body, 0o600))).toEqual({ user: "Alice@olmanager", password: "pw" });
    const error = (() => {
      try {
        readBotCredentials(write(body, 0o644));
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toBeInstanceOf(CredentialsError);
    expect(error?.message).toMatch(/chmod 600/);
    expect(error?.message).not.toContain("pw\n");
  });

  it("strips one pair of matching surrounding quotes from values", () => {
    const text = "LEAGUEPEDIA_BOT_USER='Alice@olmanager'\nLEAGUEPEDIA_BOT_PASSWORD=\"abc\"\nOTHER=\"x'\nQ=''a''\n";
    expect(parseCredentialsText(text)).toEqual({
      LEAGUEPEDIA_BOT_USER: "Alice@olmanager",
      LEAGUEPEDIA_BOT_PASSWORD: "abc",
      OTHER: "\"x'",
      Q: "'a'",
    });
  });

  it("sends the unquoted password read from a quoted file", () => {
    const file = write('LEAGUEPEDIA_BOT_USER="Alice@olmanager"\nLEAGUEPEDIA_BOT_PASSWORD="abc"\n');
    expect(readBotCredentials(file)).toEqual({ user: "Alice@olmanager", password: "abc" });
  });

  it("still refuses a 0644 file and closes the descriptor", () => {
    const file = write("LEAGUEPEDIA_BOT_USER=a\nLEAGUEPEDIA_BOT_PASSWORD=b\n", 0o644);
    const close = vi.spyOn(fs, "closeSync");
    expect(() => readBotCredentials(file)).toThrow(/chmod 600/);
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });

  it("reports a missing key or file with a pointer to the docs, never the password", () => {
    const file = write("LEAGUEPEDIA_BOT_PASSWORD=topsecret\n");
    expect(() => readBotCredentials(file)).toThrow(/LEAGUEPEDIA_BOT_USER/);
    expect(() => readBotCredentials(file)).toThrow(/Logging in/);
    try {
      readBotCredentials(file);
    } catch (e) {
      expect((e as Error).message).not.toContain("topsecret");
    }
    expect(() => readBotCredentials(path.join(dir, "nope.env"))).toThrow(/not found.*Logging in/);
  });

  it("never puts the password or token into a log message, a stats snapshot or an error", async () => {
    const make = (fetchImpl: FetchImpl, extra: Partial<MediaWikiClientOptions> = {}) =>
      new MediaWikiClient({ cacheDir: os.tmpdir(), throttleMs: 0, sleep: async () => {}, fetchImpl, ...extra });
    const logs: string[] = [];
    const fetchImpl = vi
      .fn<(url: string, init: Init) => Promise<Response>>()
      .mockResolvedValueOnce(reply({ query: { tokens: { logintoken: "tok+\\" } } }))
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
    const client = make(fetchImpl as unknown as FetchImpl, { log: (message) => logs.push(message) });
    const error = await client.login(creds).catch((e) => e);
    const dump = JSON.stringify([logs, error.message, error.stats]);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain("tok+");
    expect(error.stats.retryReasons).toEqual({ "TypeError: fetch failed (ECONNRESET)": 1 });
    expect(logs).toEqual(["attempt 1/1 failed: TypeError: fetch failed (ECONNRESET); giving up"]);
  });

  it("records a rejected login HTTP status without any request details", async () => {
    const make = (fetchImpl: FetchImpl, extra: Partial<MediaWikiClientOptions> = {}) =>
      new MediaWikiClient({ cacheDir: os.tmpdir(), throttleMs: 0, sleep: async () => {}, fetchImpl, ...extra });
    const logs: string[] = [];
    const fetchImpl = vi
      .fn<(url: string, init: Init) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("{}", { status: 403 }));
    const client = make(fetchImpl as unknown as FetchImpl, { log: (message) => logs.push(message) });
    await expect(client.login(creds)).rejects.toThrow("login request failed: HTTP 403");
    expect(client.stats.retryReasons).toEqual({ "HTTP 403": 1 });
    expect(logs.join()).not.toContain(PASSWORD);
  });
});
