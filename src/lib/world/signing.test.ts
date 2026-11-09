// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_KEY_PATH,
  PUBLIC_KEY_FILE,
  fingerprint,
  generateKeypair,
  publicKeyFromPrivatePem,
  resolveKeyPath,
  signBytes,
  signOverlayFile,
  verifyBytes,
  verifyOverlayFile,
} from "../../../scripts/world/lib/signing.mjs";

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "olm-sign-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("overlay signing", () => {
  it("creates a 0600 key outside the repo and returns only the public key", () => {
    const keyPath = path.join(tmp(), "nested", "key.pem");
    const result = generateKeypair(keyPath);
    expect(result.created).toBe(true);
    expect(Buffer.from(result.publicKey, "base64")).toHaveLength(32);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(publicKeyFromPrivatePem(fs.readFileSync(keyPath, "utf8"))).toBe(result.publicKey);
  });

  it("never overwrites an existing key", () => {
    const keyPath = path.join(tmp(), "key.pem");
    const first = generateKeypair(keyPath);
    const before = fs.readFileSync(keyPath, "utf8");
    const second = generateKeypair(keyPath);
    expect(second.created).toBe(false);
    expect(second.publicKey).toBe(first.publicKey);
    expect(fs.readFileSync(keyPath, "utf8")).toBe(before);
  });

  it("signs bytes into a 64-byte base64 signature that verifies", () => {
    const keyPath = path.join(tmp(), "key.pem");
    const { publicKey } = generateKeypair(keyPath);
    const pem = fs.readFileSync(keyPath, "utf8");
    const bytes = Buffer.from('{"a":1}\n');
    const sig = signBytes(bytes, pem);
    expect(Buffer.from(sig, "base64")).toHaveLength(64);
    expect(verifyBytes(bytes, sig, publicKey)).toBe(true);
  });

  it("rejects tampered bytes, a wrong key and malformed signatures", () => {
    const dir = tmp();
    const a = generateKeypair(path.join(dir, "a.pem"));
    const b = generateKeypair(path.join(dir, "b.pem"));
    const pem = fs.readFileSync(path.join(dir, "a.pem"), "utf8");
    const bytes = Buffer.from("overlay");
    const sig = signBytes(bytes, pem);
    expect(verifyBytes(Buffer.from("overlaz"), sig, a.publicKey)).toBe(false);
    expect(verifyBytes(bytes, sig, b.publicKey)).toBe(false);
    expect(verifyBytes(bytes, "not base64!!", a.publicKey)).toBe(false);
    expect(verifyBytes(bytes, Buffer.alloc(10).toString("base64"), a.publicKey)).toBe(false);
  });

  it("writes <file>.sig and verifies the pair, failing when the sig is missing or stale", () => {
    const dir = tmp();
    const { publicKey } = generateKeypair(path.join(dir, "k.pem"));
    const file = path.join(dir, "overlay.json");
    fs.writeFileSync(file, "{}\n");
    expect(verifyOverlayFile(file, publicKey)).toEqual({ ok: false, reason: "missing-signature" });
    signOverlayFile(file, fs.readFileSync(path.join(dir, "k.pem"), "utf8"));
    expect(fs.readFileSync(`${file}.sig`, "utf8")).toMatch(/^[A-Za-z0-9+/]{86}==\n$/);
    expect(verifyOverlayFile(file, publicKey)).toEqual({ ok: true });
    fs.writeFileSync(file, "{ }\n");
    expect(verifyOverlayFile(file, publicKey)).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("resolves the key path from the env var, else the default", () => {
    expect(resolveKeyPath({ OLM_OVERLAY_SIGNING_KEY: "/x/k.pem" })).toBe("/x/k.pem");
    expect(resolveKeyPath({})).toBe(DEFAULT_KEY_PATH);
    expect(DEFAULT_KEY_PATH.endsWith(path.join(".config", "olmanager", "overlay-signing-key.pem"))).toBe(true);
  });

  it("fingerprints a public key as sha256 hex", () => {
    expect(fingerprint(Buffer.alloc(32).toString("base64"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the committed bundled overlay carries a valid signature for the committed public key", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const publicKey = fs.readFileSync(path.join(root, PUBLIC_KEY_FILE), "utf8").trim();
    expect(verifyOverlayFile(path.join(root, "assets/world/roster-overlay.json"), publicKey)).toEqual({ ok: true });
  });
});
