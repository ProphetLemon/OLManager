import { readFileSync, writeFileSync } from "node:fs";
import { CURATION_SOURCE, applyCounterCuration } from "./lib/champion-counter-curation.mjs";

const legacyCatalog = JSON.parse(readFileSync(new URL("../assets/simulation/champions.json", import.meta.url), "utf8"));
const legacy = legacyCatalog.data;
const curation = JSON.parse(readFileSync(new URL("../assets/simulation/champion-counter-curation.json", import.meta.url), "utf8"));
const capturedAt = "2026-08-02";

function canonicalChampionId(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "wukong" || normalized === "monkeyking" ? "monkeyking" : normalized;
}

function legacyReview(kind) {
  return {
    status: "legacy_baseline",
    confidence: "low",
    review_flags: ["legacy_catalog", "source_unverified", "relationship_review_required"],
    review: {
      required: true,
      next_review_at: "2026-11-02",
      reason: `Migrated ${kind} relationship without independently verifiable source evidence.`,
    },
  };
}

const roles = Object.entries(legacy.roles)
  .map(([legacyId, championRoles]) => ({
    champion_id: canonicalChampionId(legacyId),
    legacy_id: legacyId,
    roles: championRoles,
    status: "legacy_baseline",
    confidence: "low",
    review_flags: ["legacy_catalog", "source_unverified", "role_review_required"],
  }))
  .sort((left, right) => left.champion_id.localeCompare(right.champion_id));

const legacyCounters = legacy.counterpicks.map(({ a, b, value }) => ({
  source: canonicalChampionId(a),
  target: canonicalChampionId(b),
  value,
}));
const curatedCounters = applyCounterCuration(legacyCounters, curation);

function curatedReview({ confidence, reason }) {
  const nextReviewYear = Number(curation.metadata.reviewed_at.slice(0, 4)) + 1;
  return {
    status: "curated",
    confidence,
    review_flags: ["curated_general_knowledge"],
    review: {
      required: true,
      next_review_at: `${nextReviewYear}${curation.metadata.reviewed_at.slice(4)}`,
      reason: `Curated from general lane-matchup knowledge; re-review on major champion changes. ${reason}`,
    },
  };
}

const counters = curatedCounters.counters.map(({ source, target, value, curated }) => ({
  source,
  target,
  value,
  directionality: "directed",
  stability: "foundational",
  patch_validity: null,
  ...(curated
    ? { ...curatedReview(curated), rationale: curated.reason }
    : legacyReview("counter")),
}));

const groupedSynergies = new Map();
for (const relationship of legacy.synergies) {
  const source = canonicalChampionId(relationship.a);
  const target = canonicalChampionId(relationship.b);
  const [first, second] = [source, target].sort();
  const key = `${first}::${second}`;
  const entries = groupedSynergies.get(key) ?? [];
  entries.push({ source, target, value: relationship.value });
  groupedSynergies.set(key, entries);
}

const reductions = [];
const synergies = [...groupedSynergies.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, entries]) => {
    const [source, target] = key.split("::");
    const value = Math.max(...entries.map((entry) => entry.value));
    if (entries.length > 1) reductions.push({ pair: [source, target], legacy_entries: entries, retained_value: value });
    return {
      source,
      target,
      value,
      directionality: "undirected",
      stability: "foundational",
      patch_validity: null,
      ...legacyReview("synergy"),
    };
  });

const dataset = {
  schemaVersion: 1,
  dataset: "champion-relationships",
  captured_at: capturedAt,
  provenance: {
    status: "legacy_baseline",
    source_catalog: "assets/simulation/champions.json",
    source_schema_version: legacyCatalog.schema_version,
    source_extracted_at: legacyCatalog.extracted_at,
    statement: "Imported as an auditable legacy baseline. It is not independently verified official relationship data.",
  },
  semantics: {
    counters: "Directed: source counters target. Reverse direction is a distinct relationship.",
    synergies: "Undirected: source and target are stored in ascending canonical ID order and apply equally in either order.",
    foundational: "Generally stable relationship. It has an explicit scheduled review and no claimed patch validity.",
    patch_sensitive: "Reserved for future sourced, potentially patch-dependent relationships. It requires explicit patch-validity fields and review on patch changes.",
  },
  migration: {
    legacy_counts: {
      roles: roles.length,
      counters: legacy.counterpicks.length,
      synergies: legacy.synergies.length,
    },
    curation: {
      source: CURATION_SOURCE,
      schemaVersion: curation.metadata.schemaVersion,
      reviewed_at: curation.metadata.reviewed_at,
      basis: curation.metadata.basis,
      changes: curatedCounters.summary,
      counters_after_curation: counters.length,
    },
    synergy_duplicate_reduction: {
      strategy: "maximum_value",
      rationale: "The legacy runtime selected the maximum value when both directional entries existed. This preserves its effective result while making synergy order-independent.",
      duplicate_pairs_reduced: reductions.length,
      duplicate_entries_removed: legacy.synergies.length - synergies.length,
      audit: reductions,
    },
  },
  roles,
  counters,
  synergies,
};

writeFileSync(new URL("../data/champions/champion-relationships.v1.json", import.meta.url), `${JSON.stringify(dataset, null, 2)}\n`);
