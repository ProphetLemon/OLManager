import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

type Template = { subject: string; body: string };
type Locale = { be: { msg: { matchResult: { templates: Record<string, Template> } } } };

const LOCALES: Record<string, Locale> = { de, en, es, fr, it: itLocale, pt, "pt-BR": ptBR, tr } as Record<string, Locale>;

// {{score}} is "<user team>:<own wins>-<opponent wins>" and already names the user's club;
// {{homeWins}}-{{awayWins}} is the fixture-order series score; {{userScore}} puts the user's
// club first and {{opponentScore}} puts the opponent first.
describe("be.msg.matchResult.templates", () => {
  it.each(Object.entries(LOCALES))("%s never puts the user-side score between the home and away names", (_lang, locale) => {
    for (const [id, template] of Object.entries(locale.be.msg.matchResult.templates)) {
      for (const text of [template.subject, template.body]) {
        expect(text, `${id}: {{score}} next to {{home}}/{{away}}`).not.toMatch(/\{\{home\}\}\s*\{\{score\}\}/);
        if (text.includes("{{homeWins}}")) {
          expect(text, id).toContain("{{home}} {{homeWins}}-{{awayWins}} {{away}}");
        }
      }
    }
  });

  it.each(Object.entries(LOCALES))("%s scores a sentence by its subject", (_lang, locale) => {
    const templates = locale.be.msg.matchResult.templates;
    // defeat_2 is written with the opponent as the grammatical subject, so the opponent's wins go first.
    for (const text of [templates.defeat_2.subject, templates.defeat_2.body]) {
      expect(text).toContain("{{opponentScore}}");
      expect(text).not.toContain("{{userScore}}");
    }
    // Every other sentence that prints a plain user score has the user's club as its subject.
    for (const [id, template] of Object.entries(templates)) {
      if (id === "defeat_2") continue;
      expect(`${template.subject}${template.body}`, id).not.toContain("{{opponentScore}}");
    }
  });

  it.each(Object.entries(LOCALES))("%s uses only parameters the backend sends", (_lang, locale) => {
    const sent = new Set(["home", "away", "score", "homeWins", "awayWins", "userScore", "opponentScore", "opponent", "matchday"]);
    for (const [id, template] of Object.entries(locale.be.msg.matchResult.templates)) {
      for (const [, name] of `${template.subject}${template.body}`.matchAll(/\{\{(\w+)\}\}/g)) {
        expect(sent.has(name), `${id} uses {{${name}}}`).toBe(true);
      }
    }
  });
});
