import { describe, expect, it } from "vitest";
import { formatDateFull, formatMatchDate } from "./dateFormatting";

describe("the short game date of the header bar", () => {
  const day = "2026-11-17";

  it.each(["en", "es", "fr", "de", "it", "pt", "pt-BR", "tr"])(
    "%s: abbreviates the weekday and the month, drops the year, and is shorter than the full date",
    (lang) => {
      const short = formatMatchDate(day, lang);
      const full = formatDateFull(day, lang);
      expect(short).not.toContain("2026");
      expect(short).toContain("17");
      expect(short.length).toBeLessThan(full.length);
      expect(short.length).toBeLessThanOrEqual(18);
    },
  );

  it("follows the locale's own order and names", () => {
    expect(formatMatchDate(day, "en")).toMatch(/Tue.*Nov.*17/);
    expect(formatMatchDate(day, "fr")).toMatch(/mar\..*17.*nov/);
    expect(formatMatchDate(day, "de")).toMatch(/Di.*17.*Nov/);
  });

  it("returns an unparsable date as it came", () => {
    expect(formatMatchDate("soon", "en")).toBe("soon");
  });
});
