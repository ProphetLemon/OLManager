import { describe, expect, it } from "vitest";
import {
  DECAY_PREVIEW_DAYS,
  DECAY_PREVIEW_START_LP,
  SOLOQ_DECAY_FALLBACK_PRESETS,
  SOLOQ_DECAY_NEW_CAREER_MODE,
  findPreset,
  previewDecay,
} from "./soloqDecay";

describe("soloq decay presets", () => {
  it("starts new careers on Real", () => {
    expect(SOLOQ_DECAY_NEW_CAREER_MODE).toBe("Real");
  });

  it("falls back to the spec table when the engine sent none", () => {
    expect(findPreset(null, "Harsh")).toMatchObject({ decay_per_idle_day: 75, bank_days: 7, recovery_per_played_day: 150 });
    expect(findPreset([], "Soft")).toMatchObject({ decay_per_idle_day: 25, bank_days: 21, recovery_per_played_day: 50 });
    expect(SOLOQ_DECAY_FALLBACK_PRESETS.map((preset) => preset.mode)).toEqual(["Off", "Soft", "Real", "Harsh"]);
  });

  it("prefers the numbers the engine returned", () => {
    const engine = [{ mode: "Real" as const, decay_per_idle_day: 60, bank_days: 10, recovery_per_played_day: 120 }];
    expect(findPreset(engine, "Real")?.decay_per_idle_day).toBe(60);
  });
});

describe("previewDecay", () => {
  it("is flat with decay off", () => {
    const preview = previewDecay(null);
    expect(new Set(preview.points)).toEqual(new Set([DECAY_PREVIEW_START_LP]));
    expect(preview.floorDay).toBeNull();
    expect(preview.lost).toBe(0);
  });

  it("holds through the grace period, then loses the rate per idle day", () => {
    const preview = previewDecay(findPreset(null, "Real"));
    expect(preview.points).toHaveLength(DECAY_PREVIEW_DAYS + 1);
    expect(preview.points[14]).toBe(900);
    expect(preview.points[15]).toBe(850);
    expect(preview.endLp).toBe(900 - 16 * 50);
    expect(preview.floorDay).toBeNull();
  });

  it("reaches Master 0 LP and stays there when the floor comes inside the window", () => {
    const preview = previewDecay(findPreset(null, "Harsh"));
    expect(preview.floorDay).toBe(7 + 12);
    expect(preview.points[19]).toBe(0);
    expect(preview.points[30]).toBe(0);
    expect(preview.lost).toBe(900);
  });
});
