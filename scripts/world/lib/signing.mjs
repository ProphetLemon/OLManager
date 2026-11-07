// Ed25519 detached signatures for assets/world/roster-overlay.json (Node built-in crypto only).
//
// Wire format: `<overlay>.sig` holds the base64 (standard alphabet, padded) of the 64-byte Ed25519
// signature over the exact overlay file bytes, plus one trailing newline. The public key is committed
// as `assets/world/overlay-signing-key.pub`: base64 of the raw 32-byte key, one line. The private key
// lives only outside the repo (PKCS#8 PEM, mode 0600) and is never printed or copied.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PUBLIC_KEY_FILE = "assets/world/overlay-signing-key.pub";
export const DEFAULT_KEY_PATH = path.join(os.homedir(), ".config", "olmanager", "overlay-signing-key.pem");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function resolveKeyPath(env = process.env) {
  const configured = env.OLM_OVERLAY_SIGNING_KEY?.trim();
  return configured ? configured : DEFAULT_KEY_PATH;
}

function rawPublicKey(privateKey) {
  const spki = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return spki.subarray(spki.length - 32);
}

export function publicKeyFromPrivatePem(pem) {
  return rawPublicKey(crypto.createPrivateKey(pem)).toString("base64");
}

export function fingerprint(publicKeyBase64) {
  return crypto.createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest("hex");
}

/** Creates a keypair only when no key exists at `keyPath`; never overwrites. Returns the public key only. */
export function generateKeypair(keyPath) {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" });
  try {
    fs.writeFileSync(keyPath, pem, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { created: false, publicKey: publicKeyFromPrivatePem(fs.readFileSync(keyPath, "utf8")) };
  }
  return { created: true, publicKey: rawPublicKey(privateKey).toString("base64") };
}

export function signBytes(bytes, privatePem) {
  return crypto.sign(null, bytes, crypto.createPrivateKey(privatePem)).toString("base64");
}

export function verifyBytes(bytes, signatureBase64, publicKeyBase64) {
  const text = String(signatureBase64).trim();
  if (!BASE64.test(text)) return false;
  const signature = Buffer.from(text, "base64");
  const raw = Buffer.from(String(publicKeyBase64).trim(), "base64");
  if (signature.length !== 64 || raw.length !== 32) return false;
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
  return crypto.verify(null, bytes, key, signature);
}

export function signOverlayFile(file, privatePem) {
  const signature = signBytes(fs.readFileSync(file), privatePem);
  fs.writeFileSync(`${file}.sig`, `${signature}\n`);
  return signature;
}

export function verifyOverlayFile(file, publicKeyBase64) {
  const sigFile = `${file}.sig`;
  if (!fs.existsSync(sigFile)) return { ok: false, reason: "missing-signature" };
  const ok = verifyBytes(fs.readFileSync(file), fs.readFileSync(sigFile, "utf8"), publicKeyBase64);
  return ok ? { ok: true } : { ok: false, reason: "invalid-signature" };
}
