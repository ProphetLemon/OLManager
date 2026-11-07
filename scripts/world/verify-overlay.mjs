#!/usr/bin/env node
// Validates a roster overlay against the bundled data/ (schema, ids, teams). Not part of dev/build chains.
import fs from "node:fs";
import path from "node:path";
import { formatErrors, validateOverlay } from "./lib/overlay-schema.mjs";
import { PUBLIC_KEY_FILE, verifyOverlayFile } from "./lib/signing.mjs";
import { loadWorld, toOverlayWorld } from "./lib/world.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const file = path.resolve(process.argv[2] ?? path.join(ROOT, "assets/world/roster-overlay.json"));
const dataDir = path.resolve(process.argv[3] ?? path.join(ROOT, "data"));

if (!fs.existsSync(file)) {
  console.log(`verify:world-overlay: no overlay at ${file}; nothing to verify`);
  process.exit(0);
}
const overlay = JSON.parse(fs.readFileSync(file, "utf8"));
const result = validateOverlay(overlay, toOverlayWorld(loadWorld(dataDir)));
if (!result.ok) {
  console.error(`verify:world-overlay: ${result.errors.length} problem(s) in ${file}\n${formatErrors(result.errors)}`);
  process.exit(1);
}
const publicKeyFile = path.join(ROOT, PUBLIC_KEY_FILE);
const signature = verifyOverlayFile(file, fs.readFileSync(publicKeyFile, "utf8").trim());
if (!signature.ok) {
  console.error(`verify:world-overlay: ${signature.reason} for ${file} against ${PUBLIC_KEY_FILE}; re-sign with "npm run world:sign"`);
  process.exit(1);
}
console.log(`verify:world-overlay: ${file} OK (${overlay.players.length} player ops, ${overlay.staff.length} staff ops, as of ${overlay.as_of}, signature valid)`);
