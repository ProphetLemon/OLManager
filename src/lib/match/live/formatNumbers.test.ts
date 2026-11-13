import { describe, expect, it } from "vitest";

import { compactGold } from "./formatNumbers";

describe("compactGold", () => {
  it("writes whole numbers under a thousand", () => {
    expect(compactGold(0)).toBe("0");
    expect(compactGold(742.4)).toBe("742");
    expect(compactGold(999)).toBe("999");
  });

  it("writes thousands with one decimal and a k", () => {
    expect(compactGold(1000, "en")).toBe("1.0k");
    expect(compactGold(12350, "en")).toBe("12.4k");
    expect(compactGold(61_040, "en")).toBe("61.0k");
  });

  it("follows the decimal mark of the locale", () => {
    expect(compactGold(12350, "es")).toBe("12,4k");
    expect(compactGold(12350, "de")).toBe("12,4k");
  });

  it("reads the size of an amount, so a deficit and a lead give the same text", () => {
    expect(compactGold(-2400, "en")).toBe("2.4k");
    expect(compactGold(Number.NaN)).toBe("0");
  });
});
