import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type Tree = {
  scrims: { decision: { targetedDrills: string } };
  be: { msg: { scrimWeekly: { recommendations: { targetedDrills: string } } } };
};

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

describe("the weekly scrim report names the Targeted Drills option as the UI does", () => {
  it.each(Object.keys(LOCALES))("%s uses the translated option name", (code) => {
    const tree = LOCALES[code];
    const optionName = tree.scrims.decision.targetedDrills;
    const text = tree.be.msg.scrimWeekly.recommendations.targetedDrills;

    expect(text).toContain(optionName);
    if (code !== "en") expect(text).not.toContain("Targeted Drills");
  });
});
