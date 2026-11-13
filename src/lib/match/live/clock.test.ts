import { describe, expect, it } from "vitest";

import { formatCountdown } from "./clock";

describe("formatCountdown", () => {
  it("writes minutes and two digit seconds", () => {
    expect(formatCountdown(31)).toBe("0:31");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(600)).toBe("10:00");
  });

  it("rounds up, so a countdown shows 0:00 only when nothing is left", () => {
    expect(formatCountdown(30.2)).toBe("0:31");
    expect(formatCountdown(0.01)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
  });

  it("reads a negative or broken count as zero", () => {
    expect(formatCountdown(-4)).toBe("0:00");
    expect(formatCountdown(Number.NaN)).toBe("0:00");
    expect(formatCountdown(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
