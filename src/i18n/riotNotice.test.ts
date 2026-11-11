import { describe, expect, it } from "vitest";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import it_ from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

const LOCALES: Record<string, { settings: { riotNotice: string } }> = {
  de,
  en,
  es,
  fr,
  it: it_,
  "pt-BR": ptBR,
  pt,
  tr,
};

// Riot's policy for fan projects asks for a visible notice that Riot does not endorse or
// sponsor the project. The About section of Settings shows `settings.riotNotice`.
describe("Riot Games fan project notice", () => {
  it.each(Object.keys(LOCALES))("%s names the project and Riot Games", (locale) => {
    const notice = LOCALES[locale].settings.riotNotice;
    expect(notice).toContain("Open League Manager");
    expect(notice).toContain("Riot Games");
    expect(notice).toContain("League of Legends");
  });

  it("is translated outside English", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      if (locale === "en") continue;
      expect(messages.settings.riotNotice, locale).not.toBe(en.settings.riotNotice);
    }
  });
});
