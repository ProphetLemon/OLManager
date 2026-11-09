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
      migration: { legacy_counts: { counters: 2464 } },
    });
    expect(championRelationships.roles).toHaveLength(172);
    expect(championRelationships.counters).toHaveLength(2468);
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

describe("Heimerdinger and Quinn catalog entries", () => {
  const roleRow = (id: string) => championRelationships.roles.find((row) => row.champion_id === id);

  it("carry exactly the timings roles", () => {
    expect(roleRow("heimerdinger")?.roles).toEqual(["Mid", "Support"]);
    expect(roleRow("quinn")?.roles).toEqual(["Top"]);
  });

  it("fit their own lanes and no other", () => {
    expect(championFitsLane(roleRow("heimerdinger")!.roles, "Mid")).toBe(true);
    expect(championFitsLane(roleRow("heimerdinger")!.roles, "Top")).toBe(false);
    expect(championFitsLane(roleRow("quinn")!.roles, "Top")).toBe(true);
    expect(championFitsLane(roleRow("quinn")!.roles, "Mid")).toBe(false);
  });

  it("add Quinn over Darius as a one-way curated counter", () => {
    expect(getChampionCounterValue("Quinn", "Darius")).toBe(3);
    expect(getChampionCounterValue("Darius", "Quinn")).toBe(0);
  });
});

describe("curated counter corrections", () => {
  it("raises Malphite over Yasuo to a strong counter", () => {
    expect(getChampionCounterValue("Malphite", "Yasuo")).toBe(3);
  });

  it("downgrades Sylas over Shyvana from near-unplayable to a slight edge", () => {
    expect(getChampionCounterValue("Sylas", "Shyvana")).toBe(1);
  });

  it("downgrades Yone over Aurelion Sol from near-unplayable to a clear edge", () => {
    expect(getChampionCounterValue("Yone", "AurelionSol")).toBe(2);
  });

  it("adds Rammus as a hard counter to Master Yi without a reverse entry", () => {
    expect(getChampionCounterValue("Rammus", "MasterYi")).toBe(4);
    expect(getChampionCounterValue("MasterYi", "Rammus")).toBe(0);
  });

  it("removes Kayle over Garen, which was wrongly listed as a counter", () => {
    expect(getChampionCounterValue("Kayle", "Garen")).toBe(0);
    expect(getChampionCounterValue("Garen", "Kayle")).toBe(0);
  });

  it("inverts Blitzcrank over Morgana to Morgana over Blitzcrank", () => {
    expect(getChampionCounterValue("Blitzcrank", "Morgana")).toBe(0);
    expect(getChampionCounterValue("Morgana", "Blitzcrank")).toBe(2);
  });

  it("inverts Ezreal over Caitlyn to Caitlyn over Ezreal", () => {
    expect(getChampionCounterValue("Ezreal", "Caitlyn")).toBe(0);
    expect(getChampionCounterValue("Caitlyn", "Ezreal")).toBe(2);
  });

  it("inverts Fiora over Gwen to Gwen over Fiora", () => {
    expect(getChampionCounterValue("Fiora", "Gwen")).toBe(0);
    expect(getChampionCounterValue("Gwen", "Fiora")).toBeGreaterThan(0);
  });

  it("applies medium-confidence sets, adds and inversions from the refutation-confirmed batch", () => {
    expect(getChampionCounterValue("Mel", "Vex")).toBe(3);
    expect(getChampionCounterValue("Janna", "Brand")).toBe(1);
    expect(getChampionCounterValue("Malzahar", "Zed")).toBe(2);
    expect(getChampionCounterValue("Leona", "Vel'Koz")).toBe(2);
    expect(getChampionCounterValue("Vel'Koz", "Leona")).toBe(0);
  });

  it("marks curated entries and keeps legacy entries untouched", () => {
    const curated = championRelationships.counters.filter((relationship) => relationship.status === "curated");
    expect(curated.map((relationship) => `${relationship.source}->${relationship.target}`).sort()).toEqual([
      "braum->senna",
      "caitlyn->ezreal",
      "fizz->azir",
      "fizz->cassiopeia",
      "fizz->ziggs",
      "galio->veigar",
      "gwen->fiora",
      "gwen->riven",
      "irelia->naafiri",
      "janna->brand",
      "jax->irelia",
      "jax->volibear",
      "jayce->volibear",
      "karma->xerath",
      "leona->velkoz",
      "leona->xerath",
      "lissandra->naafiri",
      "malphite->yasuo",
      "malzahar->zed",
      "mel->vex",
      "morgana->blitzcrank",
      "morgana->pyke",
      "naafiri->aurelionsol",
      "quinn->darius",
      "rammus->masteryi",
      "sylas->shyvana",
      "yasuo->naafiri",
      "yone->aurelionsol",
      "yone->naafiri",
      "yuumi->morgana",
      "yuumi->swain",
      "yuumi->zyra",
    ]);
    expect(curated.every((relationship) => ["high", "medium"].includes(relationship.confidence) && relationship.review_flags.includes("curated_general_knowledge"))).toBe(true);
    expect(getChampionCounterValue("Aatrox", "Cho'Gath")).toBe(1);
  });

  it("has no mutual counter pairs", () => {
    const keys = new Set(championRelationships.counters.map((relationship) => `${relationship.source}::${relationship.target}`));
    expect(championRelationships.counters.filter((relationship) => keys.has(`${relationship.target}::${relationship.source}`))).toEqual([]);
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
