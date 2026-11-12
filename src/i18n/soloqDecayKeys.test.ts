import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

type Tree = { soloqDecay?: Record<string, unknown> };

const OTHERS = { es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr } as unknown as Record<string, Tree>;
const ENGLISH = (en as unknown as Tree).soloqDecay;

function flatten(node: unknown, path = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === "string") out[path] = node;
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) flatten(value, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

describe("soloqDecay locale keys", () => {
  it("exists in English with every term the Settings control needs", () => {
    const keys = Object.keys(flatten(ENGLISH));
    for (const key of [
      "title",
      "lossPerIdleDay",
      "gracePeriod",
      "winBackPerDay",
      "noSave",
      "footnote",
      "modes.soft",
      "modes.real",
      "modes.harsh",
      "daysValue_one",
      "daysValue_other",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it.each(Object.entries(OTHERS))("%s has every English key with the same placeholders", (_name, tree) => {
    const english = flatten(ENGLISH);
    const translated = flatten(tree.soloqDecay);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      expect(placeholders(translated[key]), key).toEqual(placeholders(text));
    }
  });

  it.each(Object.entries(OTHERS))("%s translates the control instead of keeping the English text", (_name, tree) => {
    const translated = flatten(tree.soloqDecay);
    expect(translated.title).not.toBe(flatten(ENGLISH).title);
    expect(translated.footnote).not.toBe(flatten(ENGLISH).footnote);
  });
});
