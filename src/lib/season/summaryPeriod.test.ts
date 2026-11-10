import { describe, expect, it } from "vitest";

import { resolveSummaryPeriod } from "./summaryPeriod";

describe("resolveSummaryPeriod", () => {
  it("announces the new season when the league moved to a later one", () => {
    expect(resolveSummaryPeriod(2027, 2028)).toEqual({ kind: "season", season: 2028 });
  });

  it("does not announce a year when the league stays in the closed season (split change)", () => {
    expect(resolveSummaryPeriod(2027, 2027)).toEqual({ kind: "split" });
  });

  it("keeps announcing the next season when the league is not available", () => {
    expect(resolveSummaryPeriod(2027, undefined)).toEqual({ kind: "season", season: 2028 });
  });
});
