import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  de: de as Tree,
  es: es as Tree,
  fr: fr as Tree,
  it: itLocale as Tree,
  pt: pt as Tree,
  "pt-BR": ptBR as Tree,
  tr: tr as Tree,
};

const ladderOf = (locale: Tree): Record<string, string> =>
  ((locale.endOfSeason as Tree | undefined)?.ladder ?? {}) as Record<string, string>;

const placeholders = (text: string): string[] =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

const enLadder = ladderOf(en as Tree);

function usedKeys(): Set<string> {
  const source = readFileSync(
    resolve(__dirname, "../../ui-v2/components/season/PromotionRelegationCard.tsx"),
    "utf-8",
  );
  return new Set([...source.matchAll(/"endOfSeason\.ladder\.([A-Za-z]+)"/g)].map((m) => m[1]));
}

describe("endOfSeason.ladder locale keys", () => {
  it("defines the card strings in en.json", () => {
    expect(Object.keys(enLadder).length).toBeGreaterThanOrEqual(12);
  });

  it("covers every key the card uses", () => {
    const used = usedKeys();
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((key) => !enLadder[key])).toEqual([]);
  });

  it.each(Object.keys(LOCALES))("%s has exactly the en.json key set", (code) => {
    expect(Object.keys(ladderOf(LOCALES[code])).sort()).toEqual(Object.keys(enLadder).sort());
  });

  it.each(Object.keys(LOCALES))("%s keeps placeholders and is translated", (code) => {
    const locale = ladderOf(LOCALES[code]);
    for (const [key, english] of Object.entries(enLadder)) {
      expect(locale[key].trim(), `${code}: ${key}`).not.toBe("");
      expect(placeholders(locale[key]), `${code}: ${key}`).toEqual(placeholders(english));
      if (key !== "between") expect(locale[key], `${code}: ${key}`).not.toBe(english);
    }
  });
});
