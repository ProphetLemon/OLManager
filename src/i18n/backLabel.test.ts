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
  onAir: { bar: { backTo: string; backNone: string }; route: { now: string } };
}

const LOCALES = { de, en, es, fr, it: itLocale, pt, "pt-BR": ptBR, tr } as unknown as Record<string, Locale>;

/**
 * The text Back buttons show "Back" and are named "Back to {destination}" (R41).
 * WCAG 2.5.3 wants the visible label inside the name, so every locale's Back
 * names must contain its own common.back word.
 */
describe.each(Object.entries(LOCALES))("%s Back labels", (code, locale) => {
  const lower = (text: string) => text.toLocaleLowerCase(code);
  const word = lower(locale.common.back);

  it("keeps the visible Back word in the name that points somewhere", () => {
    const name = locale.onAir.bar.backTo.replace("{{destination}}", "Squad");
    expect(lower(name)).toContain(word);
  });

  it("keeps the visible Back word in the name with nowhere to go", () => {
    expect(lower(locale.onAir.bar.backNone)).toContain(word);
  });
});

describe("French Back and route labels", () => {
  it("put a no-break space before the colon", () => {
    expect(fr.onAir.bar.backTo).toContain(" :");
    expect(fr.onAir.route.now).toContain(" :");
  });
});
