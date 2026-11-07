import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "@/store/settingsStore";
import { calcAge, formatCurrencyAmount, formatVal } from "./valueFormatting";

describe("calcAge", () => {
  it("calculates age relative to the provided in-game date", () => {
    expect(calcAge("2000-07-02", "2026-07-01T00:00:00Z")).toBe(25);
    expect(calcAge("2000-07-01", "2026-07-01T00:00:00Z")).toBe(26);
  });

  it("uses the as-of year instead of the real current year", () => {
    expect(calcAge("2000-01-01", "2025-01-01T00:00:00Z")).toBe(25);
    expect(calcAge("2000-01-01", "2027-01-01T00:00:00Z")).toBe(27);
  });

  it("does not leak NaN for missing or invalid dates", () => {
    expect(calcAge("", "2026-07-01T00:00:00Z")).toBe(0);
    expect(calcAge("2000-01-01", "")).toBe(0);
  });
});

describe("formatVal with the selected currency setting", () => {
  afterEach(() => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, currency: "EUR" } });
  });

  it.each([
    ["USD", "$1.5M", "$250K"],
    ["GBP", "£1.5M", "£250K"],
    ["EUR", "€1.5M", "€250K"],
  ] as const)("uses the %s symbol when no currency is passed", (currency, millions, thousands) => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, currency } });

    expect(formatVal(1_500_000)).toBe(millions);
    expect(formatVal(250_000)).toBe(thousands);
  });

  it("formats exact amounts with the selected currency symbol", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, currency: "USD" } });

    expect(formatCurrencyAmount(12_345)).toBe("$" + (12_345).toLocaleString());
  });
});
