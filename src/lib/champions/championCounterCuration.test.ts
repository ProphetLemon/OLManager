import { describe, expect, it } from "vitest";
import {
  applyCounterCuration,
  validateCounterSet,
  validateCuration,
  type CounterCuration,
} from "../../../scripts/lib/champion-counter-curation.mjs";

const metadata = { schemaVersion: 1 as const, basis: "test", reviewed_at: "2026-11-07", method: "test" };
const legacy = [
  { source: "a", target: "b", value: 1 },
  { source: "c", target: "d", value: 5 },
];
const change = (fields: object) => ({ confidence: "high", reason: "test", ...fields }) as CounterCuration["changes"][number];

describe("applyCounterCuration", () => {
  it("sets, adds and removes while keeping legacy entries untouched", () => {
    const { counters, summary } = applyCounterCuration(legacy, {
      metadata,
      changes: [
        change({ op: "set", source: "c", target: "d", value: 2 }),
        change({ op: "add", source: "e", target: "a", value: 4 }),
        change({ op: "remove", source: "a", target: "b" }),
      ],
    });
    expect(counters.map(({ source, target, value }) => `${source}>${target}:${value}`)).toEqual(["c>d:2", "e>a:4"]);
    expect(counters[0].curated).toMatchObject({ op: "set", confidence: "high" });
    expect(summary).toEqual({ remove: 1, add: 1, set: 1 });
  });

  it("is deterministic and does not mutate its input", () => {
    const curation: CounterCuration = { metadata, changes: [change({ op: "add", source: "e", target: "a", value: 3 })] };
    expect(applyCounterCuration(legacy, curation)).toEqual(applyCounterCuration(legacy, curation));
    expect(legacy).toHaveLength(2);
  });

  it("rejects changes that do not fit the legacy data", () => {
    expect(() => applyCounterCuration(legacy, { metadata, changes: [change({ op: "set", source: "x", target: "y", value: 2 })] })).toThrow(/missing pair/);
    expect(() => applyCounterCuration(legacy, { metadata, changes: [change({ op: "add", source: "a", target: "b", value: 2 })] })).toThrow(/existing pair/);
    expect(() => applyCounterCuration(legacy, { metadata, changes: [change({ op: "remove", source: "x", target: "y" })] })).toThrow(/missing pair/);
  });
});

describe("validation", () => {
  it("rejects malformed curation files", () => {
    expect(() => validateCuration({ metadata, changes: [change({ op: "add", source: "a", target: "a", value: 2 })] })).toThrow(/distinct/);
    expect(() => validateCuration({ metadata, changes: [change({ op: "add", source: "a", target: "b", value: 6 })] })).toThrow(/1\.\.5/);
    expect(() => validateCuration({ metadata: { ...metadata, schemaVersion: 2 as never }, changes: [] })).toThrow(/schemaVersion/);
  });

  it("accepts high and medium confidence and rejects any other", () => {
    for (const confidence of ["high", "medium"]) {
      expect(() => validateCuration({ metadata, changes: [change({ op: "add", source: "a", target: "b", value: 2, confidence })] })).not.toThrow();
    }
    expect(() => validateCuration({ metadata, changes: [change({ op: "add", source: "a", target: "b", value: 2, confidence: "low" })] })).toThrow(/confidence/);
    const { counters } = applyCounterCuration(legacy, { metadata, changes: [change({ op: "add", source: "e", target: "a", value: 2, confidence: "medium" })] });
    expect(counters.at(-1)?.curated).toMatchObject({ op: "add", confidence: "medium" });
  });

  it("flags out-of-range, self, mutual and unknown counters", () => {
    const ids = new Set(["a", "b"]);
    expect(() => validateCounterSet([{ source: "a", target: "b", value: 3 }], ids)).not.toThrow();
    expect(() => validateCounterSet([{ source: "a", target: "b", value: 0 }], ids)).toThrow(/1\.\.5/);
    expect(() => validateCounterSet([{ source: "a", target: "a", value: 2 }], ids)).toThrow(/self/);
    expect(() => validateCounterSet([{ source: "a", target: "z", value: 2 }], ids)).toThrow(/unknown/);
    expect(() => validateCounterSet([{ source: "a", target: "b", value: 2 }, { source: "b", target: "a", value: 2 }], ids)).toThrow(/mutual/);
  });
});
