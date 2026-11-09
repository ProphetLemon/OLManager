import { describe, expect, it } from "vitest";
import i18n from "@/i18n";

describe("lazy locale loading", () => {
  it("bundles only English up front and loads other locales on demand", async () => {
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("es", "translation")).toBe(false);

    await i18n.changeLanguage("es");

    expect(i18n.language).toBe("es");
    expect(i18n.hasResourceBundle("es", "translation")).toBe(true);
    expect(i18n.t("dashboard.home")).not.toBe(i18n.getFixedT("en")("dashboard.home"));

    await i18n.changeLanguage("en");
  });

  it("falls back to English for a region variant without its own file", async () => {
    await i18n.changeLanguage("en-US");
    expect(i18n.t("dashboard.home")).toBe(i18n.getFixedT("en")("dashboard.home"));
    await i18n.changeLanguage("en");
  });
});
