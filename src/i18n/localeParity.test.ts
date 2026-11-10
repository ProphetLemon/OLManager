import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

type Tree = Record<string, unknown>;

const LOCALES: Record<string, Tree> = {
  de,
  es,
  fr,
  it: itLocale,
  pt,
  "pt-BR": ptBR,
  tr,
};

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Flattened key set with the i18next plural suffixes stripped. */
function keySet(node: unknown, path = "", out = new Set<string>()): Set<string> {
  if (typeof node === "string") {
    out.add(path.replace(PLURAL_SUFFIX, ""));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Tree)) {
      keySet(value, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

const enKeys = keySet(en);

describe("locale key parity", () => {
  it.each(Object.entries(LOCALES))("%s has every key that en has", (_name, tree) => {
    const keys = keySet(tree);
    const missing = [...enKeys].filter((key) => !keys.has(key));
    expect(missing).toEqual([]);
  });

  it("resolves the keys that used to render raw in the legacy tabs", () => {
    const required = [
      "finances.runwayWeeks",
      "match.formationFit",
      "createManager.soloq",
      "match.neutralObjectives",
      "match.statBarons",
      "match.statDragons",
      "match.statGold",
      "match.statKills",
      "match.statTowers",
    ];
    expect(required.filter((key) => !enKeys.has(key))).toEqual([]);
  });
});
