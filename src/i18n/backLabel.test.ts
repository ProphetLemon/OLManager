import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

interface Locale {
  common: { back: string };
  onAir: { bar: { backTo: string; backNone: string }; route: { now: string; nowNoGroup: string } };
}

const LOCALES = { de, en, es, fr, it: itLocale, pt, "pt-BR": ptBR, tr } as unknown as Record<string, Locale>;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The text Back buttons show "Back" and are named "Back to {destination}" (R41).
 * WCAG 2.5.3 wants the visible label inside the name, so every locale's Back
 * names must contain its own common.back word. Speech input matches words, so
 * it must stand as a word, not inside a compound such as "Zurückgehen" (R54).
 */
describe.each(Object.entries(LOCALES))("%s Back labels", (_code, locale) => {
  const word = new RegExp(`(^|[^\\p{L}])${escapeRegExp(locale.common.back)}([^\\p{L}]|$)`, "iu");

  it("keeps the visible Back word in the name that points somewhere", () => {
    const name = locale.onAir.bar.backTo.replace("{{destination}}", "Squad");
    expect(name).toMatch(word);
  });

  it("keeps the visible Back word in the name with nowhere to go", () => {
    expect(locale.onAir.bar.backNone).toMatch(word);
  });
});

/** A translation that drops or renames a placeholder shows it raw or loses the value (CR5). */
describe.each(Object.entries(LOCALES))("%s Back and route placeholders", (_code, locale) => {
  it("keeps {{destination}} in the Back name", () => {
    expect(locale.onAir.bar.backTo).toContain("{{destination}}");
  });

  it("keeps {{title}} and {{group}} in the arrival", () => {
    expect(locale.onAir.route.now).toContain("{{title}}");
    expect(locale.onAir.route.now).toContain("{{group}}");
  });

  it("keeps {{title}} and has no {{group}} in the arrival at a direct stop", () => {
    expect(locale.onAir.route.nowNoGroup).toContain("{{title}}");
    expect(locale.onAir.route.nowNoGroup).not.toContain("{{group}}");
  });
});

describe("French Back and route labels", () => {
  it("put a no-break space before the colon", () => {
    expect(fr.onAir.bar.backTo).toContain(" :");
    expect(fr.onAir.route.now).toContain(" :");
  });
});
