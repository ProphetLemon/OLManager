import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

const LOCALES = { de, en, es, fr, it: itLocale, pt, "pt-BR": ptBR, tr };

describe("roster status line texts", () => {
  // The line shows one or the other: identical texts would hide that an update happened.
  it.each(Object.entries(LOCALES))("tells 'rosters as of' from 'rosters updated to' in %s", (_locale, tree) => {
    expect(tree.rosterOverlay.updated).not.toBe(tree.rosterOverlay.asOf);
  });
});
