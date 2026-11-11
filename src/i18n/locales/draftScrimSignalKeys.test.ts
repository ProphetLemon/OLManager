import { afterEach, describe, expect, it } from "vitest";

import i18n from "../index";
import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type DraftBlock = { scrimSignalTitle?: string; scrimSignalReasons?: Record<string, string> };

// The reasons are the identifiers calculateScrimDraftSignal returns; the draft screen looks them up here.
const REASON_IDS = ["recent champion reps", "scrimmed core together", "recent prep vs this opponent"];
const LOCALES = { de, en, es, fr, it: itLocale, pt, "pt-BR": ptBR, tr } as unknown as Record<
  string,
  { match: { draft: DraftBlock } }
>;

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("draft screen scrim signal texts", () => {
  it.each(Object.entries(LOCALES))("%s translates the title and every reason", (lang, locale) => {
    const draft = locale.match.draft;
    expect(draft.scrimSignalTitle, `${lang} title`).toBeTruthy();
    for (const id of REASON_IDS) {
      const text = draft.scrimSignalReasons?.[id];
      expect(text, `${lang} ${id}`).toBeTruthy();
      if (lang !== "en") expect(text, `${lang} ${id} is still English`).not.toBe(LOCALES.en.match.draft.scrimSignalReasons?.[id]);
    }
  });

  it("renders the Spanish reason instead of the English identifier", async () => {
    await i18n.changeLanguage("es");
    const text = i18n.t("match.draft.scrimSignalReasons.recent prep vs this opponent", {
      defaultValue: "recent prep vs this opponent",
    });
    expect(text).toBe("preparación reciente contra este rival");
  });
});
