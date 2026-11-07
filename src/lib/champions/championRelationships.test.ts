import { describe, expect, it } from "vitest";
import championRelationships from "../../../data/champions/champion-relationships.v1.json";
import {
  areLaneOpponents,
  championFitsLane,
  getChampionCounterValue,
  laneCounterValue,
} from "./championRelationships";

describe("champion relationships", () => {
  it("uses the versioned relationship dataset from the data submodule", () => {
    expect(championRelationships).toMatchObject({
      schemaVersion: 1,
      dataset: "champion-relationships",
      provenance: { status: "legacy_baseline" },
    });
    expect(championRelationships.roles).toHaveLength(170);
    expect(championRelationships.counters).toHaveLength(2464);
    expect(championRelationships.synergies).toHaveLength(670);
  });

  it("keeps the legacy baseline foundational, with directed counters and canonical undirected synergies", () => {
    expect(getChampionCounterValue("Aatrox", "Cho'Gath")).toBe(1);
    expect(getChampionCounterValue("Cho'Gath", "Aatrox")).not.toBe(1);
    expect(championRelationships.counters.every((relationship) => relationship.directionality === "directed" && relationship.stability === "foundational" && relationship.patch_validity === null)).toBe(true);
    expect(championRelationships.synergies.every((relationship) => relationship.directionality === "undirected" && relationship.source < relationship.target && relationship.stability === "foundational")).toBe(true);
  });

  it("records all 22 legacy synergy reductions", () => {
    expect(championRelationships.migration.synergy_duplicate_reduction).toMatchObject({
      strategy: "maximum_value",
      duplicate_pairs_reduced: 22,
      duplicate_entries_removed: 22,
    });
    expect(championRelationships.migration.synergy_duplicate_reduction.audit).toHaveLength(22);
  });
});

describe("lane-aware counters", () => {
  const firstCounter = championRelationships.counters.find((entry) => entry.value > 0)!;

  it("treats Bot (ADC) and Support as the same lane and other roles as distinct lanes", () => {
    expect(areLaneOpponents("ADC", "SUPPORT")).toBe(true);
    expect(areLaneOpponents("TOP", "TOP")).toBe(true);
    expect(areLaneOpponents("TOP", "JUNGLE")).toBe(false);
    expect(areLaneOpponents("MID", "ADC")).toBe(false);
  });

  it("keeps counting when either role is unknown", () => {
    expect(areLaneOpponents(undefined, "TOP")).toBe(true);
    expect(areLaneOpponents("MID", null)).toBe(true);
    expect(areLaneOpponents("FLEX", "TOP")).toBe(true);
  });

  it("gives no counter credit across lanes but keeps it between lane opponents", () => {
    const raw = getChampionCounterValue(firstCounter.source, firstCounter.target);
    expect(raw).toBeGreaterThan(0);
    expect(laneCounterValue(firstCounter.source, "TOP", firstCounter.target, "SUPPORT")).toBe(0);
    expect(laneCounterValue(firstCounter.source, "TOP", firstCounter.target, "TOP")).toBe(raw);
    expect(laneCounterValue(firstCounter.source, undefined, firstCounter.target, "TOP")).toBe(raw);
  });

  it("matches candidate role hints against a lane", () => {
    expect(championFitsLane(["TOP", "MID"], "MID")).toBe(true);
    expect(championFitsLane(["SUPPORT"], "ADC")).toBe(true);
    expect(championFitsLane(["JUNGLE"], "TOP")).toBe(false);
    expect(championFitsLane([], "TOP")).toBe(true);
    expect(championFitsLane(["JUNGLE"], undefined)).toBe(true);
  });
});
