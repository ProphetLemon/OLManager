import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

const LOCALES = { en, es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr } as Record<
  string,
  { championPage: Record<string, string> }
>;

describe("championPage unit keys", () => {
  it.each(Object.entries(LOCALES))("%s has the games and minutes units", (_name, tree) => {
    for (const key of ["gamesShort", "minutesShort"]) {
      const value = tree.championPage[key];
      expect(typeof value).toBe("string");
      expect(value).toContain("{{count}}");
    }
  });

  it.each(Object.entries(LOCALES).filter(([name]) => name !== "en"))(
    "%s does not reuse the English single-letter units",
    (_name, tree) => {
      expect(tree.championPage.gamesShort).not.toBe(en.championPage.gamesShort);
      expect(tree.championPage.minutesShort).not.toBe(en.championPage.minutesShort);
    },
  );
});
