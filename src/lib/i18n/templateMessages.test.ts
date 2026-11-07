import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { resolveMessage } from "./backendI18n";
import type { MessageData } from "../../store/gameStore";

/** A message as the backend stores it for a template trigger: English text plus keys and params. */
function stored(fields: Partial<MessageData>): MessageData {
  return {
    id: "m1",
    subject: "",
    body: "",
    sender: "Assistant Coach",
    sender_role: "Assistant Coach",
    date: "2026-01-01",
    read: false,
    category: "General",
    priority: "Normal",
    actions: [],
    context: { team_id: null, player_id: null },
    ...fields,
  } as unknown as MessageData;
}

async function renderIn(lang: string, msg: MessageData): Promise<MessageData> {
  await i18n.changeLanguage(lang);
  return resolveMessage(msg);
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("match messages render in the active language", () => {
  it("renders a stored-English match preview in Spanish with a translated venue and date", async () => {
    const msg = stored({
      subject: "Upcoming match: vs Fnatic",
      body: "Coach, our next match is against Fnatic (home) on 2026-02-03.",
      subject_key: "be.msg.preMatch.templates.preview_1.subject",
      body_key: "be.msg.preMatch.templates.preview_1.body",
      i18n_params: {
        opponent: "Fnatic",
        venue: "be.msg.preMatch.venue.home",
        date: "2026-02-03",
      },
    });
    const resolved = await renderIn("es", msg);
    expect(resolved.subject).toBe("Próximo partido: vs Fnatic");
    expect(resolved.body).toContain("(local)");
    expect(resolved.body).toContain("3 de febrero de 2026");
    expect(resolved.body).not.toContain("Coach, our next");
  });

  it("renders a stored-English match result in Spanish", async () => {
    const msg = stored({
      subject: "Victory! KOI:2-1 against G2",
      body: "Great result today, coach! We beat G2 KOI:2-1.",
      subject_key: "be.msg.matchResult.templates.victory_1.subject",
      body_key: "be.msg.matchResult.templates.victory_1.body",
      i18n_params: { home: "KOI", away: "G2", score: "KOI:2-1", opponent: "G2", matchday: "3" },
    });
    const resolved = await renderIn("es", msg);
    expect(resolved.subject).toBe("¡Victoria! KOI:2-1 contra G2");
    expect(resolved.body).toContain("Hemos ganado a G2 KOI:2-1");
  });
});
