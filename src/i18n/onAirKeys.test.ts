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

function flatten(node: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node === "string") {
    out.set(path, node);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Tree)) {
      for (const [p, v] of flatten(value, path ? `${path}.${key}` : key)) {
        out.set(p, v);
      }
    }
  }
  return out;
}

function variables(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

const enOnAir = flatten((en as Tree).onAir, "onAir");
const REQUIRED = new Map([
  ...enOnAir,
  ["dashboard.sectionMarket", (en as { dashboard: Tree }).dashboard.sectionMarket as string],
]);

function scoped(locale: Tree): Map<string, string> {
  const all = new Map([
    ...flatten(locale.onAir, "onAir"),
    ["dashboard.sectionMarket", (locale.dashboard as Tree).sectionMarket as string],
  ]);
  return all;
}

describe("onAir i18n keys", () => {
  it("defines the manifest in English", () => {
    expect(REQUIRED.size).toBeGreaterThan(100);
    for (const key of [
      "onAir.nav.rail",
      "onAir.bar.toResolve_one",
      "onAir.bar.toResolve_other",
      "onAir.home.daysToGo_other",
      "onAir.home.daysToMatch_one",
      "onAir.home.daysToMatch_other",
      "onAir.calls.consequence.generic",
      "onAir.squad.importLimit",
      "onAir.match.map.label",
      "onAir.match.state.dead",
      "onAir.match.state.recall",
      "onAir.match.badge.recall",
      "onAir.match.badge.fighting",
      "onAir.match.legend.ringRecall",
      "onAir.match.legend.ringDead",
      "dashboard.sectionMarket",
    ]) {
      expect(REQUIRED.has(key), key).toBe(true);
    }
  });

  it.each(Object.entries(LOCALES))("%s has the same key set as en", (_name, locale) => {
    const keys = [...scoped(locale).keys()].sort();
    expect(keys).toEqual([...REQUIRED.keys()].sort());
  });

  it.each(Object.entries(LOCALES))("%s keeps interpolation variables", (_name, locale) => {
    const translated = scoped(locale);
    for (const [key, source] of REQUIRED) {
      expect(variables(translated.get(key) ?? ""), key).toEqual(variables(source));
    }
  });

  it.each([["en", en as Tree], ...Object.entries(LOCALES)])(
    "%s has no empty strings",
    (_name, locale) => {
      for (const [key, value] of scoped(locale)) {
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    },
  );

  it.each([["en", en as Tree], ...Object.entries(LOCALES)])(
    "%s provides both plural forms wherever one exists",
    (_name, locale) => {
      const keys = new Set(scoped(locale).keys());
      for (const key of keys) {
        if (key.endsWith("_one")) {
          expect(keys.has(key.replace(/_one$/, "_other")), key).toBe(true);
        }
      }
    },
  );
});
