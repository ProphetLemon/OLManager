#!/usr/bin/env node
// Signs an overlay file with the private key; writes <file>.sig. Usage: npm run world:sign [-- path/to/overlay.json]
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_KEY_FILE, publicKeyFromPrivatePem, resolveKeyPath, signOverlayFile, verifyOverlayFile } from "./lib/signing.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const file = path.resolve(process.argv[2] ?? path.join(ROOT, "assets/world/roster-overlay.json"));
const keyPath = resolveKeyPath();
if (!fs.existsSync(keyPath)) {
  console.error(`world:sign: no private key at ${keyPath}. Run "npm run world:keygen" first (or set OLM_OVERLAY_SIGNING_KEY).`);
  process.exit(1);
}
const pem = fs.readFileSync(keyPath, "utf8");
signOverlayFile(file, pem);
console.log(`world:sign: wrote ${file}.sig`);
const committed = path.join(ROOT, PUBLIC_KEY_FILE);
if (fs.existsSync(committed) && fs.readFileSync(committed, "utf8").trim() !== publicKeyFromPrivatePem(pem)) {
  console.error(`world:sign: WARNING the signing key does not match the committed ${PUBLIC_KEY_FILE}; the app will reject this signature`);
  process.exitCode = 1;
} else if (fs.existsSync(committed)) {
  const result = verifyOverlayFile(file, fs.readFileSync(committed, "utf8").trim());
  if (!result.ok) process.exitCode = 1;
}
