import i18next from "i18next";
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
  en: en as Tree,
  es: es as Tree,
  fr: fr as Tree,
  it: itLocale as Tree,
  pt: pt as Tree,
  "pt-BR": ptBR as Tree,
  tr: tr as Tree,
};

/** Params the backend sends with each day-one text (`welcome_message`, `i18n_params`). */
const WELCOME_PARAMS = ["count", "days", "team"];

const placeholders = (text: string): string[] =>
  [...new Set([...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]))].sort();

function lookup(tree: Tree, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<string | Tree | undefined>(
      (node, part) => (node && typeof node === "object" ? node[part] : undefined),
      tree,
    );
  return typeof value === "string" ? value : undefined;
}

/** Mirrors `resolve` in backendI18n.ts, which turns the string `count` into a number. */
async function translator(locale: string) {
  const instance = i18next.createInstance();
  await instance.init({
    lng: locale,
    resources: { [locale]: { translation: LOCALES[locale] } },
    interpolation: { escapeValue: false },
  });
  return instance;
}

describe("generic welcome countdown", () => {
  const prefix = "be.msg.welcome.templates.welcome";

  it.each(Object.keys(LOCALES))("%s has a singular and a plural body", (locale) => {
    expect(lookup(LOCALES[locale], `${prefix}.body_one`), "body_one").toBeTypeOf("string");
    expect(lookup(LOCALES[locale], `${prefix}.body_other`), "body_other").toBeTypeOf("string");
  });

  it.each(Object.keys(LOCALES))("%s uses only params the backend sends", (locale) => {
    for (const form of ["body_one", "body_other"]) {
      const used = placeholders(lookup(LOCALES[locale], `${prefix}.${form}`) ?? "");
      expect(used.filter((name) => !WELCOME_PARAMS.includes(name)), `${locale} ${form}`).toEqual([]);
      expect(used, `${locale} ${form} shows the countdown`).toContain("days");
    }
  });

  it.each(Object.keys(LOCALES))("%s reads 1 day and 16 days with the real number", async (locale) => {
    const t = (await translator(locale)).t;
    const one = t(`${prefix}.body`, { team: "Rayo", days: "1", count: 1 });
    const many = t(`${prefix}.body`, { team: "Rayo", days: "16", count: 16 });
    expect(one).toContain("1");
    expect(one).not.toContain("16");
    expect(many).toContain("16");
    expect(one).not.toBe(many);
  });

  it("uses the singular noun for one day in English", async () => {
    const t = (await translator("en")).t;
    expect(t(`${prefix}.body`, { team: "Rayo", days: "1", count: 1 })).toContain("1 day away");
    expect(t(`${prefix}.body`, { team: "Rayo", days: "16", count: 16 })).toContain("16 days away");
  });
});
