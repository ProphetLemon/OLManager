import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import i18next from "i18next";
import { describe, expect, it } from "vitest";

import de from "@/i18n/locales/de.json";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import fr from "@/i18n/locales/fr.json";
import itLocale from "@/i18n/locales/it.json";
import ptBR from "@/i18n/locales/pt-BR.json";
import pt from "@/i18n/locales/pt.json";
import tr from "@/i18n/locales/tr.json";

import { resolveInboxCategoryLabel } from "./categoryLabel";

const MESSAGE_RS = resolve(
  __dirname,
  "../../../src-tauri/crates/olm_core/src/domain/message.rs",
);

const LOCALES = { en, es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr };

/** Variants of `pub enum MessageCategory { ... }` in the Rust domain code. */
function backendCategories(): string[] {
  const source = readFileSync(MESSAGE_RS, "utf8");
  const body = /pub enum MessageCategory\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
  return body
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim().replace(/,$/, ""))
    .filter((line) => /^[A-Z][A-Za-z]*$/.test(line));
}

async function translatorFor(language: keyof typeof LOCALES) {
  const instance = i18next.createInstance();
  await instance.init({
    lng: language,
    resources: { [language]: { translation: LOCALES[language] } },
    interpolation: { escapeValue: false },
  });
  return instance.t;
}

describe("resolveInboxCategoryLabel", () => {
  it("reads the category list from the Rust sources", () => {
    const categories = backendCategories();
    expect(categories).toContain("Training");
    expect(categories).toContain("JobOffer");
    expect(categories.length).toBeGreaterThanOrEqual(15);
  });

  it.each(Object.keys(LOCALES) as (keyof typeof LOCALES)[])(
    "labels every backend category in %s without leaking a key",
    async (language) => {
      const t = await translatorFor(language);
      for (const category of backendCategories()) {
        const label = resolveInboxCategoryLabel(t, category);
        expect(label, `${language}:${category}`).not.toMatch(/^inbox\./);
        expect(label, `${language}:${category}`).not.toBe("");
      }
    },
  );

  it("resolves the capitalised Training category to the lowercase locale key", async () => {
    const t = await translatorFor("en");
    expect(resolveInboxCategoryLabel(t, "Training")).toBe("Training");
    const tEs = await translatorFor("es");
    expect(resolveInboxCategoryLabel(tEs, "Training")).toBe(es.inbox.categories.training);
  });

  it("falls back to the raw category for an unknown category", async () => {
    const t = await translatorFor("en");
    expect(resolveInboxCategoryLabel(t, "Brand New")).toBe("Brand New");
  });
});
