import { describe, expect, it } from "vitest";

import { formatDecimal } from "./decimalFormatting";

describe("formatDecimal", () => {
  it.each([
    ["es", "6,1"],
    ["de", "6,1"],
    ["fr", "6,1"],
    ["en", "6.1"],
    ["es-ES", "6,1"],
  ])("writes 6.1 in %s as %s", (locale, expected) => {
    expect(formatDecimal(6.1, 1, locale)).toBe(expected);
  });

  it("keeps toFixed digits and rounding, including the binary-rounding edge cases", () => {
    expect(formatDecimal(1.005, 2, "en")).toBe("1.00");
    expect(formatDecimal(1.005, 2, "es")).toBe("1,00");
    expect(formatDecimal(6, 1, "es")).toBe("6,0");
    expect(formatDecimal(-0.25, 2, "es")).toBe("-0,25");
    expect(formatDecimal(1234.5, 1, "es")).toBe("1234,5");
  });

  it("writes whole numbers with no mark", () => {
    expect(formatDecimal(67.4, 0, "es")).toBe("67");
  });

  it("falls back to the placeholder for missing or non-finite values", () => {
    expect(formatDecimal(undefined, 1, "es")).toBe("-");
    expect(formatDecimal(null, 1, "es")).toBe("-");
    expect(formatDecimal(Number.NaN, 1, "es")).toBe("-");
    expect(formatDecimal(Infinity, 1, "es")).toBe("-");
    expect(formatDecimal(null, 1, "es", "—")).toBe("—");
  });
});
