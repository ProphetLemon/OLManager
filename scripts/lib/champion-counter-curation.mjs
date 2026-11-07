// Pure overlay logic shared by the relationship generator and verifier.
// No I/O: callers load the legacy counters and the curation file.

export const CURATION_SOURCE = "assets/simulation/champion-counter-curation.json";
export const CURATION_OPS = ["remove", "add", "set"];
export const CURATION_CONFIDENCES = ["high"];

const pairKey = (source, target) => `${source}::${target}`;

/** Throws on a malformed curation document. Returns it unchanged. */
export function validateCuration(curation) {
  const fail = (message) => {
    throw new Error(`invalid counter curation: ${message}`);
  };
  if (curation?.metadata?.schemaVersion !== 1) fail("metadata.schemaVersion must be 1");
  for (const field of ["basis", "reviewed_at", "method"]) {
    if (typeof curation.metadata[field] !== "string" || !curation.metadata[field]) fail(`metadata.${field} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(curation.metadata.reviewed_at)) fail("metadata.reviewed_at must be an ISO date");
  if (!Array.isArray(curation.changes)) fail("changes must be an array");
  const seen = new Set();
  for (const [index, change] of curation.changes.entries()) {
    const label = `changes[${index}]`;
    if (!CURATION_OPS.includes(change.op)) fail(`${label} has unsupported op`);
    if (!change.source || !change.target || change.source === change.target) fail(`${label} needs distinct source and target`);
    if (change.op !== "remove" && (!Number.isInteger(change.value) || change.value < 1 || change.value > 5)) fail(`${label} value must be an integer 1..5`);
    if (change.op === "remove" && "value" in change) fail(`${label} remove must not carry a value`);
    if (!CURATION_CONFIDENCES.includes(change.confidence)) fail(`${label} has unsupported confidence`);
    if (typeof change.reason !== "string" || !change.reason) fail(`${label} needs a reason`);
    const key = pairKey(change.source, change.target);
    if (seen.has(key)) fail(`${label} duplicates a change for ${key}`);
    seen.add(key);
  }
  return curation;
}

/**
 * Applies the curation to canonical legacy counters ({source, target, value}).
 * Legacy order is preserved; "set" replaces in place and "add" appends in change order.
 * Returns { counters: [{source, target, value, curated: null | {op, confidence, reason}}], summary }.
 */
export function applyCounterCuration(legacyCounters, curation) {
  validateCuration(curation);
  const entries = new Map();
  for (const { source, target, value } of legacyCounters) {
    entries.set(pairKey(source, target), { source, target, value, curated: null });
  }
  const summary = { remove: 0, add: 0, set: 0 };
  for (const change of curation.changes) {
    const key = pairKey(change.source, change.target);
    const current = entries.get(key);
    if (change.op === "remove") {
      if (!current) throw new Error(`counter curation cannot remove missing pair ${key}`);
      entries.delete(key);
    } else if (change.op === "set") {
      if (!current) throw new Error(`counter curation cannot set missing pair ${key}`);
      entries.set(key, { source: change.source, target: change.target, value: change.value, curated: curatedMark(change) });
    } else {
      if (current) throw new Error(`counter curation cannot add existing pair ${key}`);
      entries.set(key, { source: change.source, target: change.target, value: change.value, curated: curatedMark(change) });
    }
    summary[change.op] += 1;
  }
  return { counters: [...entries.values()], summary };
}

function curatedMark({ op, confidence, reason }) {
  return { op, confidence, reason };
}

/** Throws unless the counters are integer 1..5, free of self and mutual pairs, and use known champion IDs. */
export function validateCounterSet(counters, knownIds) {
  const keys = new Set();
  for (const { source, target, value } of counters) {
    const key = pairKey(source, target);
    if (!knownIds.has(source) || !knownIds.has(target)) throw new Error(`counter ${key} references an unknown champion`);
    if (source === target) throw new Error(`counter ${key} is self-referential`);
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`counter ${key} must be an integer 1..5, got ${value}`);
    if (keys.has(key)) throw new Error(`duplicate counter: ${key}`);
    keys.add(key);
  }
  for (const { source, target } of counters) {
    if (keys.has(pairKey(target, source))) throw new Error(`mutual counter pair: ${source} <-> ${target}`);
  }
}
