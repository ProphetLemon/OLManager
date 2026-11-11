import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type Tree = Record<string, unknown>;

const OTHER_LOCALES: Record<string, Tree> = { es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr };

/** Post-match scrim panel, weekly scrim report and the scrim planner texts. */
const SCRIM_PREFIXES = ["match.scrimPrep.", "be.msg.scrimWeekly.", "training.scrims."];

function flatten(node: unknown, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  if (node === null || typeof node !== "object") return {};
  return Object.entries(node as Tree).reduce<Record<string, string>>(
    (acc, [key, value]) => ({ ...acc, ...flatten(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

function scrimEntries(tree: Tree): Record<string, string> {
  return Object.fromEntries(
    Object.entries(flatten(tree)).filter(([key]) => SCRIM_PREFIXES.some((prefix) => key.startsWith(prefix))),
  );
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
}

const EN_SCRIM = scrimEntries(en as Tree);

describe("scrim texts in every locale", () => {
  it.each(Object.keys(OTHER_LOCALES))("%s keeps the placeholders of the English scrim texts", (locale) => {
    const texts = scrimEntries(OTHER_LOCALES[locale]);
    for (const [key, source] of Object.entries(EN_SCRIM)) {
      expect(texts[key], `${key} in ${locale}`).toBeTypeOf("string");
      expect(placeholders(texts[key]), `${key} placeholders in ${locale}`).toEqual(placeholders(source));
    }
  });

  it.each(["de", "it", "tr"])("%s translates the post-match scrim panel and the weekly report", (locale) => {
    const texts = scrimEntries(OTHER_LOCALES[locale]);
    const mustDiffer = [
      "match.scrimPrep.title",
      "match.scrimPrep.summary",
      "match.scrimPrep.details.opponentPrep",
      "match.scrimPrep.details.championComfort",
      "be.msg.scrimWeekly.subject",
      "be.msg.scrimWeekly.body",
      "be.msg.scrimWeekly.recommendations.lockPlans",
      "be.msg.scrimWeekly.recommendations.reduceCancellations",
      "be.msg.scrimWeekly.recommendations.resetBeforeVolume",
      "be.msg.scrimWeekly.recommendations.narrowFocus",
      "be.msg.scrimWeekly.recommendations.targetedDrills",
      "be.msg.scrimWeekly.recommendations.keepPlan",
    ];
    for (const key of mustDiffer) {
      expect(texts[key], `${key} in ${locale}`).not.toBe(EN_SCRIM[key]);
    }
  });

  it("writes the Spanish scrim texts without the English jargon the rest of the locale already translates", () => {
    const english = /champion pool|early game|\btiming\b|\bcomfort\b|\bissue\b/i;
    for (const [key, text] of Object.entries(scrimEntries(es as Tree))) {
      expect(text, key).not.toMatch(english);
    }
  });
});
