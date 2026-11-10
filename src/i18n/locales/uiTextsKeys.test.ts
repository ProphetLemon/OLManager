import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type Tree = { [key: string]: string | Tree };

const LOCALES: Record<string, Tree> = {
  en: en as Tree,
  de: de as Tree,
  es: es as Tree,
  fr: fr as Tree,
  it: itLocale as Tree,
  pt: pt as Tree,
  "pt-BR": ptBR as Tree,
  tr: tr as Tree,
};

function lookup(locale: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = locale;
  for (const part of key.split(".")) {
    if (!node || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

/**
 * Keys that must exist in all 8 locales with the same placeholders as English and a
 * text of their own (a copy of the English string is a defect), unless the word is the
 * same in a language, which `sameAsEnglishOk` lists per key.
 */
function expectTranslated(keys: readonly string[], sameAsEnglishOk: Record<string, readonly string[]> = {}) {
  for (const key of keys) {
    const english = lookup(LOCALES.en, key);
    expect(english, `${key} in en`).toBeTruthy();
    for (const [lang, tree] of Object.entries(LOCALES)) {
      const text = lookup(tree, key);
      expect(text, `${key} in ${lang}`).toBeTruthy();
      expect(placeholders(text!), `${key} placeholders in ${lang}`).toEqual(placeholders(english!));
      if (lang !== "en" && !sameAsEnglishOk[key]?.includes(lang)) {
        expect(text, `${key} in ${lang} is the English text`).not.toBe(english);
      }
    }
  }
}

describe("end-of-season summary keys", () => {
  it("translates the period titles and the league line in every locale", () => {
    expectTranslated(
      [
        "endOfSeason.newSeason",
        "endOfSeason.newSplit",
        "endOfSeason.leagueSeason",
        "endOfSeason.newScheduleReleased",
        "endOfSeason.seasonComplete",
        "endOfSeason.startNextSeason",
        "tournaments.playoffBracketTitle",
      ],
    );
  });
});

describe("inbox message keys", () => {
  it("translates the board, community, call-up, press and sponsor messages in every locale", () => {
    expectTranslated(
      [
        "boardConfidence.subject",
        "boardConfidence.body0",
        "boardConfidence.body1",
        "community.subject0",
        "community.subject1",
        "community.body0",
        "community.body1",
        "intlCallup.subject",
        "intlCallup.body",
        "mediaNegative.subject",
        "mediaNegative.body",
        "mediaPositive.subject",
        "mediaPositive.body",
        "sponsor.subject",
      ].map((key) => `be.msg.${key}`),
    );
  });
});
