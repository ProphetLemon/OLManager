import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type Columns = Record<string, string>;
const columnsOf = (locale: unknown): Columns =>
  (locale as { match: { draftResult: { columns: Columns } } }).match.draftResult.columns;

const KEYS = ["damage", "gold", "goldEarned", "rating"];
const OTHERS: Record<string, unknown> = { de, es, fr, it: itLocale, "pt-BR": ptBR, pt, tr };

describe("post-match row column labels", () => {
  it("English names every column", () => {
    expect(Object.keys(columnsOf(en)).sort()).toEqual(KEYS);
  });

  it.each(Object.entries(OTHERS))("%s has a translated text for every column", (_name, locale) => {
    const columns = columnsOf(locale);
    expect(Object.keys(columns).sort()).toEqual(KEYS);
    for (const key of KEYS) {
      expect(columns[key].trim()).not.toBe("");
    }
    // Damage and rating are different words in every language; gold may be a loanword.
    expect(columns.damage).not.toBe(columnsOf(en).damage);
    expect(columns.rating).not.toBe(columnsOf(en).rating);
    expect(columns.goldEarned).not.toBe(columnsOf(en).goldEarned);
  });
});
