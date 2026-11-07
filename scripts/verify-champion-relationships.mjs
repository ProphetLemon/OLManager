import { readFileSync } from "node:fs";
import { CURATION_SOURCE, applyCounterCuration, validateCounterSet } from "./lib/champion-counter-curation.mjs";

const datasetUrl = new URL("../data/champions/champion-relationships.v1.json", import.meta.url);
const legacyCatalogUrl = new URL("../assets/simulation/champions.json", import.meta.url);
const curationUrl = new URL("../assets/simulation/champion-counter-curation.json", import.meta.url);
const canonicalRoles = new Set(["Top", "Jungle", "Mid", "Bot", "Support"]);
const stabilityValues = new Set(["foundational", "patch_sensitive"]);

function fail(message) {
  throw new Error(`[champion-relationships] ${message}`);
}

function canonicalChampionId(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "wukong" || normalized === "monkeyking" ? "monkeyking" : normalized;
}

function readJson(url, label) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    fail(`${label} is unavailable or invalid: ${error.message}`);
  }
}

function validateReview(relationship, kind, index) {
  if (relationship.status === "curated") {
    if (kind !== "counters") fail(`${kind}[${index}] only counters can be curated`);
    if (relationship.confidence !== "high" || !relationship.review_flags?.includes("curated_general_knowledge") || !relationship.rationale) {
      fail(`${kind}[${index}] curated entries need high confidence, the curated_general_knowledge flag and a rationale`);
    }
    if (!relationship.review?.required || !/^\d{4}-\d{2}-\d{2}$/.test(relationship.review.next_review_at ?? "")) {
      fail(`${kind}[${index}] must require an explicit dated review`);
    }
    return;
  }
  if (relationship.status !== "legacy_baseline" || relationship.confidence !== "low") {
    fail(`${kind}[${index}] must retain legacy_baseline status and low confidence`);
  }
  if (!Array.isArray(relationship.review_flags) || !relationship.review_flags.includes("source_unverified")) {
    fail(`${kind}[${index}] must flag unverified legacy provenance`);
  }
  if (!relationship.review?.required || !/^\d{4}-\d{2}-\d{2}$/.test(relationship.review.next_review_at ?? "")) {
    fail(`${kind}[${index}] must require an explicit dated review`);
  }
}

const dataset = readJson(datasetUrl, "relationship dataset");
const legacy = readJson(legacyCatalogUrl, "legacy champion catalog");
const curation = readJson(curationUrl, "counter curation");
if (dataset.schemaVersion !== 1 || dataset.dataset !== "champion-relationships") fail("unsupported schema identity");
if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset.captured_at ?? "")) fail("captured_at must be an ISO date");
if (dataset.provenance?.status !== "legacy_baseline" || !/not independently verified official/i.test(dataset.provenance?.statement ?? "")) {
  fail("provenance must disclose the unverified legacy baseline");
}
if (!dataset.semantics || !/Directed/.test(dataset.semantics.counters) || !/Undirected/.test(dataset.semantics.synergies)) {
  fail("semantics must document directed counters and undirected synergies");
}

const rolesById = new Map();
for (const [index, role] of dataset.roles.entries()) {
  if (role.champion_id !== canonicalChampionId(role.champion_id) || !role.champion_id) fail(`roles[${index}] has a non-canonical ID`);
  if (rolesById.has(role.champion_id)) fail(`duplicate role definition: ${role.champion_id}`);
  if (!Array.isArray(role.roles) || role.roles.length === 0 || role.roles.some((value) => !canonicalRoles.has(value))) fail(`roles[${index}] has invalid roles`);
  if (role.status !== "legacy_baseline" || role.confidence !== "low" || !role.review_flags?.includes("source_unverified")) fail(`roles[${index}] lacks legacy provenance`);
  rolesById.set(role.champion_id, role);
}

function relationshipKey(relationship) {
  return `${relationship.source}::${relationship.target}`;
}

function validateRelationship(relationship, kind, index) {
  if (!rolesById.has(relationship.source) || !rolesById.has(relationship.target)) fail(`${kind}[${index}] references an unknown champion`);
  if (relationship.source !== canonicalChampionId(relationship.source) || relationship.target !== canonicalChampionId(relationship.target)) fail(`${kind}[${index}] has non-canonical IDs`);
  if (relationship.source === relationship.target) fail(`${kind}[${index}] is self-referential`);
  if (!Number.isInteger(relationship.value) || relationship.value < 0 || relationship.value > 5) fail(`${kind}[${index}] has an out-of-range value`);
  if (!stabilityValues.has(relationship.stability)) fail(`${kind}[${index}] has unsupported stability`);
  validateReview(relationship, kind, index);
  if (relationship.stability === "patch_sensitive") {
    if (!relationship.patch_validity || relationship.patch_validity.review_on_patch_change !== true) fail(`${kind}[${index}] must carry patch validity review metadata`);
  } else if (relationship.patch_validity !== null) {
    fail(`${kind}[${index}] foundational relationship cannot claim patch validity`);
  }
}

const counterKeys = new Set();
for (const [index, relationship] of dataset.counters.entries()) {
  validateRelationship(relationship, "counters", index);
  if (relationship.directionality !== "directed" || relationship.stability !== "foundational") fail(`counters[${index}] must be directed and foundational`);
  const key = relationshipKey(relationship);
  if (counterKeys.has(key)) fail(`duplicate counter: ${key}`);
  counterKeys.add(key);
}

const synergyKeys = new Set();
for (const [index, relationship] of dataset.synergies.entries()) {
  validateRelationship(relationship, "synergies", index);
  if (relationship.directionality !== "undirected" || relationship.stability !== "foundational") fail(`synergies[${index}] must be undirected and foundational`);
  if (relationship.source >= relationship.target) fail(`synergies[${index}] must use ascending canonical IDs`);
  const key = relationshipKey(relationship);
  if (synergyKeys.has(key)) fail(`duplicate synergy pair: ${key}`);
  synergyKeys.add(key);
}

if (dataset.counters.some((relationship) => relationship.stability !== "foundational" || relationship.patch_validity !== null)) {
  fail("counters must be foundational and cannot claim patch validity without source evidence");
}
if (dataset.synergies.some((relationship) => relationship.stability !== "foundational" || relationship.patch_validity !== null)) {
  fail("legacy synergies must be foundational and cannot claim patch validity without source evidence");
}

const expectedRoles = Object.entries(legacy.data.roles).map(([id, roles]) => ({ champion_id: canonicalChampionId(id), legacy_id: id, roles })).sort((left, right) => left.champion_id.localeCompare(right.champion_id));
if (JSON.stringify(dataset.roles.map(({ champion_id, legacy_id, roles }) => ({ champion_id, legacy_id, roles }))) !== JSON.stringify(expectedRoles)) fail("role migration does not exactly match the legacy catalog");

const legacyCounters = legacy.data.counterpicks.map(({ a, b, value }) => ({ source: canonicalChampionId(a), target: canonicalChampionId(b), value }));
let curated;
try {
  curated = applyCounterCuration(legacyCounters, curation);
  validateCounterSet(curated.counters, new Set(rolesById.keys()));
} catch (error) {
  fail(error.message);
}
const expectedCounters = curated.counters.map(({ source, target, value }) => `${source}::${target}::${value}`).sort();
const actualCounters = dataset.counters.map(({ source, target, value }) => `${source}::${target}::${value}`).sort();
if (JSON.stringify(actualCounters) !== JSON.stringify(expectedCounters)) fail("counter data does not exactly match the legacy catalog plus the curation overlay");
const expectedCurated = curated.counters.filter((entry) => entry.curated).map(({ source, target }) => `${source}::${target}`).sort();
const actualCurated = dataset.counters.filter((entry) => entry.status === "curated").map(relationshipKey).sort();
if (JSON.stringify(actualCurated) !== JSON.stringify(expectedCurated)) fail("curated counter entries do not match the curation overlay");
if (dataset.migration?.curation?.source !== CURATION_SOURCE || JSON.stringify(dataset.migration.curation.changes) !== JSON.stringify(curated.summary)) {
  fail("migration.curation summary does not match the curation overlay");
}
if (dataset.migration.legacy_counts?.counters !== legacy.data.counterpicks.length) fail("legacy counter count does not match the legacy catalog");

const legacySynergyGroups = new Map();
for (const { a, b, value } of legacy.data.synergies) {
  const [source, target] = [canonicalChampionId(a), canonicalChampionId(b)].sort();
  const key = `${source}::${target}`;
  const values = legacySynergyGroups.get(key) ?? [];
  values.push(value);
  legacySynergyGroups.set(key, values);
}
const expectedSynergies = [...legacySynergyGroups.entries()].map(([key, values]) => `${key}::${Math.max(...values)}`).sort();
const actualSynergies = dataset.synergies.map(({ source, target, value }) => `${source}::${target}::${value}`).sort();
if (JSON.stringify(actualSynergies) !== JSON.stringify(expectedSynergies)) fail("synergy migration does not preserve the audited maximum-value reduction");

const duplicateGroups = [...legacySynergyGroups.entries()].filter(([, values]) => values.length > 1);
if (dataset.migration?.synergy_duplicate_reduction?.duplicate_pairs_reduced !== 22 || duplicateGroups.length !== 22) fail("expected exactly 22 duplicated legacy synergy pairs");
if (dataset.migration.synergy_duplicate_reduction.duplicate_entries_removed !== 22 || legacy.data.synergies.length - dataset.synergies.length !== 22) fail("expected exactly 22 removed duplicate synergy entries");
if (dataset.migration.synergy_duplicate_reduction.audit?.length !== 22) fail("duplicate reduction audit must cover all 22 pairs");

console.log(`[champion-relationships] validated roles=${dataset.roles.length}; counters=${dataset.counters.length} (curated=${expectedCurated.length}); synergies=${dataset.synergies.length}; duplicate_pairs_reduced=22`);
