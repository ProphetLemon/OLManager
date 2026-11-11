import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import de from "@/i18n/locales/de.json";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import fr from "@/i18n/locales/fr.json";
import itLocale from "@/i18n/locales/it.json";
import pt from "@/i18n/locales/pt.json";
import ptBR from "@/i18n/locales/pt-BR.json";
import tr from "@/i18n/locales/tr.json";
import { SCRIM_FOCUS_IMPACT_KEYS, SCRIM_FOCUS_OBJECTIVE_KEYS } from "./scrimFocusKeys";

function backendFocuses(): string[] {
  const source = readFileSync(
    resolve(__dirname, "../../../src-tauri/crates/olm_core/src/domain/team.rs"),
    "utf-8",
  );
  const body = /pub enum ScrimFocus \{([^}]*)\}/.exec(source)?.[1] ?? "";
  return body
    .split(",")
    .map((variant) => variant.trim())
    .filter(Boolean);
}

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
}

describe("scrim focus texts", () => {
  it("reads the focus variants of the backend enum", () => {
    expect(backendFocuses()).toEqual(["DraftPrep", "ChampionPool", "EarlyGame", "Teamfighting", "Macro", "Mental"]);
  });

  it("has an impact text for every focus the backend can send", () => {
    for (const focus of backendFocuses()) {
      const key = (SCRIM_FOCUS_IMPACT_KEYS as Record<string, string>)[focus];
      expect(key, `impact key for ${focus}`).toBeTruthy();
      expect(typeof lookup(key), `${key} in en.json`).toBe("string");
    }
    expect(Object.keys(SCRIM_FOCUS_IMPACT_KEYS).sort()).toEqual([...backendFocuses()].sort());
  });

  it("has an objective label for every focus the backend can send", () => {
    for (const focus of backendFocuses()) {
      const key = (SCRIM_FOCUS_OBJECTIVE_KEYS as Record<string, string>)[focus];
      expect(key, `objective key for ${focus}`).toBeTruthy();
      expect(typeof lookup(key), `${key} in en.json`).toBe("string");
    }
  });

  it("builds the label and the impact text of each focus from keys of the same focus", () => {
    for (const focus of Object.keys(SCRIM_FOCUS_OBJECTIVE_KEYS) as Array<keyof typeof SCRIM_FOCUS_OBJECTIVE_KEYS>) {
      const camel = focus.charAt(0).toLowerCase() + focus.slice(1);
      expect(SCRIM_FOCUS_OBJECTIVE_KEYS[focus]).toBe(`training.scrims.objectives.${camel}`);
      expect(SCRIM_FOCUS_IMPACT_KEYS[focus]).toBe(`scrims.impact.${focus}`);
    }
  });

  const locales = { en, es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr } as Record<string, unknown>;

  it.each(Object.keys(locales))("says draft in the %s label of the draft preparation objective", (locale) => {
    const label = String(
      SCRIM_FOCUS_OBJECTIVE_KEYS.DraftPrep.split(".").reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        locales[locale],
      ),
    );
    expect(label.toLowerCase(), `${locale}: ${label}`).toContain("draft");
  });

  it("does not repeat an objective label inside a locale", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const labels = Object.values(SCRIM_FOCUS_OBJECTIVE_KEYS).map((key) =>
        key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages),
      );
      expect(new Set(labels).size, `${locale} labels ${labels.join(" | ")}`).toBe(labels.length);
    }
  });

  it("describes the Spanish draft preparation objective as a draft preparation", () => {
    expect(es.training.scrims.objectives.draftPrep).toBe("Preparar el draft contra el próximo rival");
  });
});
