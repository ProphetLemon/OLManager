import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

const LOCALES: Record<string, unknown> = { de, en, es, fr, it: itLocale, "pt-BR": ptBR, pt, tr };
const KEYS = ["playerFlexible", "playerNoDraftInfo"] as const;

function phrases(locale: unknown): Record<string, unknown> {
  return (locale as { match: { draft: { phrases: Record<string, unknown> } } }).match.draft.phrases;
}

describe("draft flexible-player tips", () => {
  for (const [name, locale] of Object.entries(LOCALES)) {
    for (const key of KEYS) {
      it(`${name} defines match.draft.phrases.${key}`, () => {
        expect(typeof phrases(locale)[key]).toBe("string");
      });
    }
  }

  it("uses distinct English text for the two tips", () => {
    expect(phrases(en).playerFlexible).not.toBe(phrases(en).playerNoDraftInfo);
    expect(phrases(en).playerFlexible).toMatch(/adapt/i);
  });
});
