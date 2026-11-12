import { describe, expect, it } from "vitest";

import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { nextPlanningMonday, scrimSetupBlockedKey } from "./setupLock";

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
    ["career_started_late", "scrims.setupLockedCareerStart"],
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

  it("explains the disabled slots and Autofill while some days have passed and others are still open", () => {
    const partial = week({ slots: [{ canEdit: false }, { canEdit: true }] as never });
    expect(scrimSetupBlockedKey(partial, false)).toBe("scrims.setupSomeSlotsPassed");
  });

  it("lets the assistant and a lock take priority over the partial-week text", () => {
    const partial = week({ slots: [{ canEdit: false }, { canEdit: true }] as never });
    expect(scrimSetupBlockedKey(partial, true)).toBe("scrims.assistantHandling");
    expect(scrimSetupBlockedKey({ ...partial, setupLocked: true, setupLockedReason: "manual" }, false)).toBe(
      "scrims.setupLockedManual",
    );
  });
});

describe("nextPlanningMonday", () => {
  it.each([
    ["2027-01-01", "2027-01-04"], // Friday of a new career's first week
    ["2027-01-03", "2027-01-04"], // Sunday
    ["2027-01-04", "2027-01-11"], // a Monday opens the week, the next opening is a week later
    ["2027-12-30T12:00:00Z", "2028-01-03"], // across the year boundary
  ])("after %s the planning reopens on %s", (current, monday) => {
    expect(nextPlanningMonday(current)).toBe(monday);
  });
});
