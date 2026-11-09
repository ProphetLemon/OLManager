import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type TeamSelectTree = { teamSelect: { searchLeague?: string } };

const LOCALES: Record<string, TeamSelectTree> = {
  de: de as TeamSelectTree,
  en: en as TeamSelectTree,
  es: es as TeamSelectTree,
  fr: fr as TeamSelectTree,
  it: itLocale as TeamSelectTree,
  pt: pt as TeamSelectTree,
  "pt-BR": ptBR as TeamSelectTree,
  tr: tr as TeamSelectTree,
};

describe("teamSelect.searchLeague", () => {
  it.each(Object.keys(LOCALES))("is defined in %s", (locale) => {
    expect(LOCALES[locale].teamSelect.searchLeague?.trim()).toBeTruthy();
  });

  it.each(Object.keys(LOCALES).filter((l) => l !== "en"))(
    "is translated in %s",
    (locale) => {
      expect(LOCALES[locale].teamSelect.searchLeague).not.toBe(
        LOCALES.en.teamSelect.searchLeague,
      );
    },
  );
});
