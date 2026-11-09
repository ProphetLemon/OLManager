import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  MAX_REROLLS,
  canRenameFounder,
  diffOverride,
  isEmptyOverrides,
  newFoundingSeed,
  overrideCount,
  parseFounderError,
  previewFoundingSquad,
  reasonKey,
  renamePlayer,
  roleKey,
  withRoleOverride,
} from "./founders";
import type { FounderFieldReason } from "./founders";

const founder = {
  nick: "Rayo",
  full_name: "Raul Vega",
  nationality: "ES",
  date_of_birth: "2004-03-02",
};

beforeEach(() => invoke.mockReset());

describe("parseFounderError", () => {
  it("parses an invalid_field rejection", () => {
    const raw = JSON.stringify({ kind: "invalid_field", role: "MID", field: "nick", reason: "taken" });
    expect(parseFounderError(raw)).toEqual({
      kind: "invalid_field",
      role: "MID",
      field: "nick",
      reason: "taken",
    });
  });

  it("parses the other kinds", () => {
    expect(parseFounderError('{"kind":"nothing_to_change"}')).toEqual({ kind: "nothing_to_change" });
    expect(parseFounderError('{"kind":"not_a_founder","player_id":"p1"}')).toEqual({
      kind: "not_a_founder",
      player_id: "p1",
    });
    expect(parseFounderError('{"kind":"player_not_found","player_id":"p2"}')).toEqual({
      kind: "player_not_found",
      player_id: "p2",
    });
  });

  it("returns null for plain strings, broken JSON and unknown shapes", () => {
    expect(parseFounderError("Another team already uses this name")).toBeNull();
    expect(parseFounderError("{not json")).toBeNull();
    expect(parseFounderError(undefined)).toBeNull();
    expect(parseFounderError('{"kind":"other"}')).toBeNull();
    expect(parseFounderError('{"kind":"invalid_field","role":"MID","field":"colour","reason":"taken"}')).toBeNull();
    expect(parseFounderError('{"kind":"invalid_field","role":"MID","field":"nick","reason":"weird"}')).toBeNull();
  });

  it("maps every reason to a locale key", () => {
    const reasons: FounderFieldReason[] = [
      "empty",
      "too_short",
      "too_long",
      "invalid_character",
      "taken",
      "not_in_region",
      "invalid_date",
      "age_changed",
    ];
    expect(reasons.map(reasonKey)).toEqual([
      "empty",
      "tooShort",
      "tooLong",
      "invalidCharacter",
      "taken",
      "notInRegion",
      "invalidDate",
      "ageChanged",
    ]);
  });
});

describe("override diffing", () => {
  it("keeps only the fields that differ from the generated founder, trimmed", () => {
    expect(
      diffOverride(founder, { nick: " Rayo ", full_name: "Raul Vega Lopez", nationality: "ES", birth_date: "2004-03-02" }),
    ).toEqual({ full_name: "Raul Vega Lopez" });
  });

  it("returns null when nothing differs", () => {
    expect(diffOverride(founder, { nick: "Rayo", full_name: "Raul Vega" })).toBeNull();
    expect(diffOverride(founder, {})).toBeNull();
  });

  it("adds, replaces and removes one role without touching the others", () => {
    const one = withRoleOverride({}, "MID", { nick: "Ray" });
    const two = withRoleOverride(one, "TOP", { nationality: "FR" });
    expect(two).toEqual({ mid: { nick: "Ray" }, top: { nationality: "FR" } });
    expect(overrideCount(two)).toBe(2);
    expect(withRoleOverride(two, "MID", { nick: "Ray2" }).mid).toEqual({ nick: "Ray2" });
    expect(withRoleOverride(two, "MID", null)).toEqual({ top: { nationality: "FR" } });
    expect(isEmptyOverrides(withRoleOverride(one, "MID", null))).toBe(true);
    expect(roleKey("SUPPORT")).toBe("support");
  });
});

describe("adapters", () => {
  it("sends the preview arguments with the backend casing and no empty overrides", async () => {
    invoke.mockResolvedValue({ players: [], wage_budget: 1, bill: 1, allowed_nationalities: [] });
    await previewFoundingSquad({
      competitionId: "les",
      replacedTeamId: "les-a",
      shortName: "RAY",
      seed: 7,
      founderOverrides: {},
    });
    expect(invoke).toHaveBeenCalledWith("preview_founding_squad", {
      competitionId: "les",
      replacedTeamId: "les-a",
      shortName: "RAY",
      seed: 7,
      founderOverrides: null,
    });

    await previewFoundingSquad({
      competitionId: "les",
      replacedTeamId: "les-a",
      shortName: "RAY",
      seed: 7,
      founderOverrides: { mid: { nick: "Ray" } },
    });
    expect(invoke.mock.calls[1][1]).toMatchObject({ founderOverrides: { mid: { nick: "Ray" } } });
  });

  it("leaves replacedTeamId out when the club joins the league", async () => {
    invoke.mockResolvedValue({ players: [], wage_budget: 1, bill: 1, allowed_nationalities: [] });
    await previewFoundingSquad({ competitionId: "les", shortName: "RAY", seed: 7 });
    await previewFoundingSquad({ competitionId: "les", replacedTeamId: null, shortName: "RAY", seed: 7 });

    for (const call of invoke.mock.calls) {
      expect(call[1]).toEqual({ competitionId: "les", shortName: "RAY", seed: 7, founderOverrides: null });
      expect(Object.keys(call[1] as object)).not.toContain("replacedTeamId");
    }
  });

  it("sends only the changed rename fields", async () => {
    invoke.mockResolvedValue({ ok: true });
    await renamePlayer("gen-ray-mid-1", { nick: "Ray" });
    expect(invoke).toHaveBeenCalledWith("rename_player", {
      playerId: "gen-ray-mid-1",
      nick: "Ray",
      fullName: null,
    });
  });

  it("draws a u32 seed", () => {
    for (let i = 0; i < 20; i += 1) {
      const seed = newFoundingSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
    expect(MAX_REROLLS).toBe(3);
  });
});

describe("canRenameFounder", () => {
  it("allows only generated founders of the manager's club", () => {
    expect(canRenameFounder({ id: "gen-ray-mid-1", team_id: "les-custom-ray" }, "les-custom-ray")).toBe(true);
    expect(canRenameFounder({ id: "gen-ray-mid-1", team_id: "les-b" }, "les-custom-ray")).toBe(false);
    expect(canRenameFounder({ id: "p-123", team_id: "les-custom-ray" }, "les-custom-ray")).toBe(false);
    expect(canRenameFounder({ id: "gen-ray-mid-1", team_id: null }, "les-custom-ray")).toBe(false);
    expect(canRenameFounder({ id: "gen-ray-mid-1", team_id: "les-custom-ray" }, null)).toBe(false);
    // A generated id on a club that is not a custom club is rejected by the backend too.
    expect(canRenameFounder({ id: "gen-ray-mid-1", team_id: "les-b" }, "les-b")).toBe(false);
  });
});
