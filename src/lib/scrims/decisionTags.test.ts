import { describe, expect, it } from "vitest";

import { DECISION_IMPACT_TAGS, isScrimTagBenefit } from "./decisionTags";

describe("scrim decision tags", () => {
  it("says that resting lowers fatigue, as a benefit", () => {
    expect(DECISION_IMPACT_TAGS.OfferRest).toContain("fatigueMinus");
    expect(isScrimTagBenefit("fatigueMinus")).toBe(true);
  });

  it("says that another block and targeted drills add fatigue, as a cost", () => {
    expect(DECISION_IMPACT_TAGS.ContinueToBlock2).toContain("fatiguePlus");
    expect(DECISION_IMPACT_TAGS.TargetedDrills).toContain("fatiguePlus");
    expect(isScrimTagBenefit("fatiguePlus")).toBe(false);
  });

  it("treats lower risk as a benefit", () => {
    expect(DECISION_IMPACT_TAGS.CancelScrims).toContain("riskMinus");
    expect(isScrimTagBenefit("riskMinus")).toBe(true);
  });

  it("reads every other tag by its sign", () => {
    expect(isScrimTagBenefit("recoveryPlus")).toBe(true);
    expect(isScrimTagBenefit("momentumPlus")).toBe(true);
    expect(isScrimTagBenefit("volumeMinus")).toBe(false);
    expect(isScrimTagBenefit("techniqueMinus")).toBe(false);
    expect(isScrimTagBenefit("recoveryMinus")).toBe(false);
  });

  it("gives every decision three tags", () => {
    for (const tags of Object.values(DECISION_IMPACT_TAGS)) {
      expect(tags).toHaveLength(3);
    }
  });
});
