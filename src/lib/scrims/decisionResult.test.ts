import { describe, expect, it } from "vitest";

import { storedDecisionAction } from "./decisionResult";

describe("storedDecisionAction", () => {
  it("maps the one-to-one decisions back to their button", () => {
    expect(storedDecisionAction("ContinuePlan", true)).toBe("ContinueToBlock2");
    expect(storedDecisionAction("PushThrough", true)).toBe("PushThrough");
    expect(storedDecisionAction("VodReview", false)).toBe("VodReview");
    expect(storedDecisionAction("MentalReset", false)).toBe("MentalReset");
    expect(storedDecisionAction("TargetedDrills", false)).toBe("TargetedDrills");
  });

  it("tells Day off by the block's place: the first block offers rest, the second closes the day", () => {
    expect(storedDecisionAction("DayOff", true)).toBe("OfferRest");
    expect(storedDecisionAction("DayOff", false)).toBe("DayOff");
  });

  it("names nothing when no decision is stored", () => {
    expect(storedDecisionAction(null, true)).toBeNull();
    expect(storedDecisionAction(undefined, false)).toBeNull();
  });
});
