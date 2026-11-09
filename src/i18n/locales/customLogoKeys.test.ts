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

/** Sources whose `teamSelect.customLogo.*` keys must resolve. */
const SOURCES = ["../../ui-v2/pages/customTeam/LogoUploadControl.tsx"];

function leaves(tree: unknown, prefix = ""): Record<string, string> {
  if (typeof tree === "string") return { [prefix]: tree };
  if (!tree || typeof tree !== "object") return {};
  return Object.entries(tree as Tree).reduce<Record<string, string>>(
    (acc, [key, value]) => ({ ...acc, ...leaves(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

const logoOf = (locale: Tree): Record<string, string> =>
  leaves((locale.teamSelect as Tree | undefined)?.customLogo);

const placeholders = (text: string): string[] =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

const enKeys = logoOf(en as Tree);

function usedKeys(): Set<string> {
  const used = new Set<string>();
  for (const relative of SOURCES) {
    const source = readFileSync(resolve(__dirname, relative), "utf-8");
    for (const match of source.matchAll(/"teamSelect\.customLogo\.([A-Za-z.]+)"/g)) {
      used.add(match[1]);
    }
  }
  return used;
}

describe("teamSelect.customLogo locale keys", () => {
  it("defines the badge upload strings in en.json", () => {
    expect(Object.keys(enKeys).length).toBeGreaterThan(10);
  });

  it.each(Object.keys(LOCALES))("%s has exactly the en.json key set", (code) => {
    expect(Object.keys(logoOf(LOCALES[code])).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it.each(["en", ...Object.keys(LOCALES)])("%s has no empty strings", (code) => {
    const tree = code === "en" ? (en as Tree) : LOCALES[code];
    const empty = Object.entries(logoOf(tree)).filter(([, value]) => value.trim() === "");
    expect(empty).toEqual([]);
  });

  it.each(Object.keys(LOCALES))("%s keeps the interpolation placeholders of en.json", (code) => {
    const values = logoOf(LOCALES[code]);
    for (const [key, text] of Object.entries(enKeys)) {
      expect(placeholders(values[key]), `${code}: ${key}`).toEqual(placeholders(text));
    }
  });

  it.each(Object.keys(LOCALES))("%s translates the strings instead of copying English", (code) => {
    const values = logoOf(LOCALES[code]);
    const copied = Object.entries(enKeys)
      .filter(([key, text]) => values[key] === text && /[a-z]{4,}/i.test(text.replace(/{{\w+}}/g, "")))
      .map(([key]) => key);
    // Only words that read the same in the language may repeat (e.g. "Identity" in Spanish
    // is not one of them); the allowance keeps true cognates from failing the check.
    expect(copied.length).toBeLessThanOrEqual(2);
  });

  it("resolves every key the upload control uses in en.json", () => {
    const missing = [...usedKeys()].filter((key) => !(key in enKeys));
    expect(missing).toEqual([]);
  });

  it("uses every key defined in en.json", () => {
    const used = usedKeys();
    expect(Object.keys(enKeys).filter((key) => !used.has(key))).toEqual([]);
  });
});
