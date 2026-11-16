import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import {
  calcAge,
  compareAgesUnknownLast,
  formatAge,
  formatCurrencyAmount,
  formatNumber,
  formatVal,
  parseDateOfBirth,
} from "./valueFormatting";

describe("calcAge", () => {
  it("calculates age relative to the provided in-game date", () => {
    expect(calcAge("2000-07-02", "2026-07-01T00:00:00Z")).toBe(25);
    expect(calcAge("2000-07-01", "2026-07-01T00:00:00Z")).toBe(26);
  });

  it("uses the as-of year instead of the real current year", () => {
    expect(calcAge("2000-01-01", "2025-01-01T00:00:00Z")).toBe(25);
    expect(calcAge("2000-01-01", "2027-01-01T00:00:00Z")).toBe(27);
  });

  it("has no age for a missing or unreadable date of birth", () => {
    expect(calcAge("", "2026-07-01T00:00:00Z")).toBeNull();
    expect(calcAge("   ", "2026-07-01T00:00:00Z")).toBeNull();
    expect(calcAge(null, "2026-07-01T00:00:00Z")).toBeNull();
    expect(calcAge(undefined, "2026-07-01T00:00:00Z")).toBeNull();
    expect(calcAge("unknown", "2026-07-01T00:00:00Z")).toBeNull();
    expect(calcAge("2006-13-40", "2026-07-01T00:00:00Z")).toBeNull();
  });

  it("has no age when the as-of date is unreadable", () => {
    expect(calcAge("2000-01-01", "")).toBeNull();
  });

  it("reads the Month D, YYYY form the data also ships", () => {
    expect(calcAge("January 19, 2006", "2027-01-01T00:00:00Z")).toBe(20);
    expect(calcAge("November 5, 2002", "2027-01-01T00:00:00Z")).toBe(24);
    expect(calcAge("january 19, 2006", "2027-01-19T00:00:00Z")).toBe(21);
  });

  it("counts the birthday the same way for both forms", () => {
    expect(calcAge("2006-01-19", "2027-01-18T00:00:00Z")).toBe(20);
    expect(calcAge("January 19, 2006", "2027-01-18T00:00:00Z")).toBe(20);
    expect(calcAge("January 19, 2006", "2027-01-19T00:00:00Z")).toBe(21);
  });
});

describe("parseDateOfBirth", () => {
  it("accepts the same two forms as the game core and nothing else", () => {
    expect(parseDateOfBirth("2006-01-19")?.toISOString()).toBe("2006-01-19T00:00:00.000Z");
    expect(parseDateOfBirth(" January 19, 2006 ")?.toISOString()).toBe("2006-01-19T00:00:00.000Z");
    for (const raw of ["", "2006", "19/01/2006", "2006-01-19T00:00:00Z", "2006-02-30"]) {
      expect(parseDateOfBirth(raw), raw).toBeNull();
    }
  });
});

describe("formatAge", () => {
  it("shows a dash for an unknown age", () => {
    expect(formatAge(null)).toBe("—");
    expect(formatAge(24)).toBe("24");
  });
});

describe("compareAgesUnknownLast", () => {
  const sortAges = (ages: (number | null)[], factor: 1 | -1) =>
    [...ages].sort((a, b) => compareAgesUnknownLast(a, b, factor));

  it("sorts unknown ages after known ones in both directions", () => {
    const ages = [22, null, 19, null, 30];
    expect(sortAges(ages, 1)).toEqual([19, 22, 30, null, null]);
    expect(sortAges(ages, -1)).toEqual([30, 22, 19, null, null]);
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

describe("negative, zero and positive amounts", () => {
  afterEach(() => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, currency: "EUR" } });
  });

  it.each([
    [-51_250, "-€51K"],
    [-2_500_000, "-€2.5M"],
    [-500, "-€500"],
    [0, "€0"],
    [500, "€500"],
    [51_250, "€51K"],
    [2_500_000, "€2.5M"],
  ])("abbreviates %i as %s with the sign first", (value, expected) => {
    expect(formatVal(value)).toBe(expected);
  });

  it("puts the sign before the symbol for every supported currency", () => {
    expect(formatVal(-51_250, "USD")).toBe("-$51K");
    expect(formatVal(-51_250, "GBP")).toBe("-£51K");
  });

  it.each([
    [-51_250, "-€" + (51_250).toLocaleString()],
    [0, "€0"],
    [51_250, "€" + (51_250).toLocaleString()],
  ])("formats the exact amount %i as %s", (value, expected) => {
    expect(formatCurrencyAmount(value)).toBe(expected);
  });

  it("uses the selected currency for negative exact amounts", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, currency: "USD" } });

    expect(formatCurrencyAmount(-51_250)).toBe("-$" + (51_250).toLocaleString());
  });
});

describe("number grouping follows the app language", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each([
    ["en", "€12,345,678"],
    ["es", "€12.345.678"],
    ["de", "€12.345.678"],
    ["fr", "€12 345 678"],
  ])("groups an exact amount in %s as %s", async (language, expected) => {
    await i18n.changeLanguage(language);

    expect(formatCurrencyAmount(12_345_678)).toBe(expected);
  });

  it("formats plain numbers with the app language", async () => {
    await i18n.changeLanguage("es");
    expect(formatNumber(1_234_567)).toBe("1.234.567");

    await i18n.changeLanguage("en");
    expect(formatNumber(1_234_567)).toBe("1,234,567");
  });
});

describe("formatVal millions follow the game language's decimal mark", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each([
    ["es", "€1,5M", "-€2,0M"],
    ["de", "€1,5M", "-€2,0M"],
    ["en", "€1.5M", "-€2.0M"],
  ])("writes millions in %s", async (language, positive, negative) => {
    await i18n.changeLanguage(language);
    expect(formatVal(1_500_000, "EUR")).toBe(positive);
    expect(formatVal(-2_000_000, "EUR")).toBe(negative);
    expect(formatVal(250_000, "EUR")).toBe("€250K");
  });
});
