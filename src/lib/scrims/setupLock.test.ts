import { describe, expect, it } from "vitest";

import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { scrimSetupBlockedKey } from "./setupLock";

function week(overrides: Partial<WeeklyScrimContext> = {}): WeeklyScrimContext {
  return {
    setupLocked: false,
    setupLockedReason: null,
    slots: [{ canEdit: true }, { canEdit: true }],
    ...overrides,
  } as unknown as WeeklyScrimContext;
}

describe("scrimSetupBlockedKey", () => {
  it("returns null while the setup can be edited", () => {
    expect(scrimSetupBlockedKey(week(), false)).toBeNull();
  });

  it("names the assistant when it is handling the scrims", () => {
    expect(scrimSetupBlockedKey(week(), true)).toBe("scrims.assistantHandling");
  });

  it.each([
    ["manual", "scrims.setupLockedManual"],
    ["week_started", "scrims.setupLockedWeekStarted"],
    ["first_scrim_window", "scrims.setupLockedFirstWindow"],
  ])("has its own text for the %s lock", (reason, key) => {
    expect(scrimSetupBlockedKey(week({ setupLocked: true, setupLockedReason: reason }), false)).toBe(key);
  });

  it("falls back to the generic lock text for a reason it does not know", () => {
    expect(scrimSetupBlockedKey(week({ setupLocked: true, setupLockedReason: "future_reason" }), false)).toBe(
      "scrims.setupLocked",
    );
    expect(scrimSetupBlockedKey(week({ setupLocked: true, setupLockedReason: null }), false)).toBe(
      "scrims.setupLocked",
    );
  });

  it("explains a week with no editable slot left even without a lock", () => {
    const passed = week({ slots: [{ canEdit: false }, { canEdit: false }] as never });
    expect(scrimSetupBlockedKey(passed, false)).toBe("scrims.setupAllSlotsPassed");
  });

  it("stays open while one slot can still be edited", () => {
    const partial = week({ slots: [{ canEdit: false }, { canEdit: true }] as never });
    expect(scrimSetupBlockedKey(partial, false)).toBeNull();
  });
});
