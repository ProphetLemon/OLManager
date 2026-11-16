#!/usr/bin/env node
// Maintainer tool: turn a SAVED Leaguepedia join into `nationality` entries of assets/world/catalog-corrections.json.
// It makes no network request. The join (Players rows plus the per-player match result) was queried once, by hand.
//
//   node scripts/world/nationality-corrections.mjs --rows lp-cargo-rows.json --detail lp-join-detail.json \
//     [--data-dir data] [--out assets/world/catalog-corrections.json] [--queried 2026-11-16] [--list review.md]
//
// Only name-confirmed matches (tiers A and A2) get an entry; existing entries are kept; the output is sorted and stable.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildNationalityCorrections, reviewListMarkdown } from "./lib/nationality-corrections.mjs";
import { CATALOG_CORRECTIONS_FILE, loadWorld } from "./lib/world.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const { values } = parseArgs({
  options: {
    rows: { type: "string" },
    detail: { type: "string" },
    "data-dir": { type: "string", default: path.join(ROOT, "data") },
    out: { type: "string", default: CATALOG_CORRECTIONS_FILE },
    queried: { type: "string", default: "2026-11-16" },
    list: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help || !values.rows || !values.detail) {
  console.log("usage: node scripts/world/nationality-corrections.mjs --rows <lp-cargo-rows.json> --detail <lp-join-detail.json> [--data-dir] [--out] [--queried YYYY-MM-DD] [--list review.md]");
  process.exit(values.help ? 0 : 2);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const existing = fs.existsSync(values.out) ? (readJson(values.out).corrections ?? []) : [];
// The shipped players as the game loads them, before any correction: a fix must start from the empty value.
const world = loadWorld(values["data-dir"], { corrections: [] });

const result = buildNationalityCorrections({
  detail: readJson(values.detail),
  rows: readJson(values.rows),
  players: world.players,
  existing,
  queried: values.queried,
});

fs.mkdirSync(path.dirname(values.out), { recursive: true });
fs.writeFileSync(values.out, `${JSON.stringify({ corrections: result.entries }, null, 2)}\n`);
if (values.list) fs.writeFileSync(values.list, reviewListMarkdown(result));

const { perTier, skipped, written } = result.report;
console.log(`wrote ${written.length} nationality corrections (${Object.entries(perTier).map(([t, n]) => `${t} ${n}`).join(", ") || "none"}) to ${values.out}; ${result.entries.length} entries in total`);
for (const s of skipped) console.warn(`skipped ${s.id} (${s.name}, tier ${s.tier}): ${s.reason}`);
