import { describe, expect, it } from "vitest";

import { formatClock, formatCountdown } from "./clock";

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

describe("formatClock", () => {
  it("writes minutes and two digit seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3725)).toBe("62:05");
  });

  it("rounds down, so the clock never runs ahead of the game", () => {
    expect(formatClock(59.99)).toBe("0:59");
    expect(formatClock(754.9)).toBe("12:34");
  });

  it("reads a negative or broken value as zero", () => {
    expect(formatClock(-3)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
});
