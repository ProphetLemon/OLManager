import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

type Tree = { scrims: Record<string, unknown> };

const LOCALES: Record<string, Tree> = {
  en: en as unknown as Tree,
  es: es as unknown as Tree,
  de: de as unknown as Tree,
  fr: fr as unknown as Tree,
  it: itLocale as unknown as Tree,
  pt: pt as unknown as Tree,
  "pt-BR": ptBR as unknown as Tree,
  tr: tr as unknown as Tree,
};

async function translator(code: string) {
  const instance = createInstance();
  await instance.init({
    lng: code,
    fallbackLng: false,
    resources: { [code]: { translation: { scrims: LOCALES[code].scrims } } },
    interpolation: { escapeValue: false },
  });
  return instance.t.bind(instance);
}

describe("the loss streak reads right for one loss", () => {
  it.each([
    ["es", "Racha de 1 derrota", "Racha de 3 derrotas"],
    ["de", "1 Niederlage in Folge", "3 Niederlagen in Folge"],
    ["fr", "Série de 1 défaite", "Série de 3 défaites"],
    ["it", "Serie di 1 sconfitta", "Serie di 3 sconfitte"],
    ["pt", "Sequência de 1 derrota", "Sequência de 3 derrotas"],
    ["pt-BR", "Sequência de 1 derrota", "Sequência de 3 derrotas"],
  ])("%s", async (code, one, many) => {
    const t = await translator(code);
    expect(t("scrims.lossStreak", { count: 1 })).toBe(one);
    expect(t("scrims.lossStreak", { count: 3 })).toBe(many);
  });
});

describe("the Spanish scrim desk copy", () => {
  const scrims = es.scrims as unknown as Record<string, unknown> & { decision: Record<string, string> };

  it("keeps no English term in the block review, the issue label and the push-through decision", () => {
    expect(scrims.reviewBlockTitle).toBe("Revisión del bloque");
    expect(scrims.detectedIssue).toBe("Problema detectado");
    expect(scrims.decision.pushThrough).toBe("Forzar el bloque");
    for (const text of [scrims.reviewBlockTitle, scrims.detectedIssue, scrims.decision.pushThrough]) {
      expect(text).not.toMatch(/review|issue|push|through/i);
    }
  });

  it("labels the report's focus so it cannot be read as the week objective", () => {
    expect(scrims.reportFocus).toBe("Enfoque del informe");
  });
});

describe.each(Object.keys(LOCALES))("%s: the not-played chip and the no-rival sentence", (code) => {
  const scrims = LOCALES[code].scrims as Record<string, unknown> & { slotStatus: Record<string, string> };

  it("has the not-played status and the no-rival sentence, without an opponent placeholder", () => {
    expect(scrims.slotStatus.notPlayed).toBeTruthy();
    expect(scrims.slotStatus.notPlayed).not.toBe(scrims.slotStatus.cancelled);
    expect(String(scrims.nothingToDecideNoRival)).toContain("{{slot}}");
    expect(String(scrims.nothingToDecideNoRival)).not.toContain("{{opponent}}");
  });
});
