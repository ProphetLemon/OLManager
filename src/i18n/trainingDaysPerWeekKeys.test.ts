import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

type TrainingTree = { training: Record<string, unknown> };

const LOCALES = { en, es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr } as unknown as Record<string, TrainingTree>;

describe("training.daysPerWeek keys", () => {
  it.each(Object.entries(LOCALES))("%s has the one and other forms", (_name, tree) => {
    expect(String(tree.training.daysPerWeek_one)).toContain("{{count}}");
    expect(String(tree.training.daysPerWeek_other)).toContain("{{count}}");
    expect(tree.training.daysPerWeek).toBeUndefined();
  });

  it.each(Object.entries(LOCALES).filter(([name]) => name !== "en"))(
    "%s does not keep the English days/week text",
    (_name, tree) => {
      expect(String(tree.training.daysPerWeek_one)).not.toMatch(/days?\/week/i);
      expect(String(tree.training.daysPerWeek_other)).not.toMatch(/days?\/week/i);
    },
  );
});
