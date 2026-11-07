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

describe("player event messages render in the active language", () => {
  it("renders a stored-English low morale message in Spanish", async () => {
    const msg = stored({
      subject: "Morale concern: Caps",
      body: "Coach, we've noticed that Caps's morale has dropped significantly. Currently at 31%.",
      subject_key: "be.msg.playerEvent.templates.low_morale_1.subject",
      body_key: "be.msg.playerEvent.templates.low_morale_1.body",
      i18n_params: { player: "Caps", morale: "31" },
    });
    const resolved = await renderIn("es", msg);
    expect(resolved.subject).toBe("Preocupación por la moral: Caps");
    expect(resolved.body).toContain("Actualmente en 31%");
  });

  it("renders a stored-English contract concern in Spanish with the days remaining", async () => {
    const msg = stored({
      subject: "Caps contract expiring in 20 days",
      body: "This is a reminder about Caps's contract situation.",
      subject_key: "be.msg.playerEvent.templates.contract_concern_2.subject",
      body_key: "be.msg.playerEvent.templates.contract_concern_2.body",
      i18n_params: { player: "Caps", days: "20" },
    });
    const resolved = await renderIn("es", msg);
    expect(resolved.subject).toBe("El contrato de Caps expira en 20 días");
    expect(resolved.body).toContain("Con solo 20 días restantes");
  });

  it("renders a stored-English bench complaint and happy player in Spanish", async () => {
    const bench = stored({
      subject: "Caps wants more game time",
      subject_key: "be.msg.playerEvent.templates.bench_complaint_1.subject",
      body_key: "be.msg.playerEvent.templates.bench_complaint_1.body",
      i18n_params: { player: "Caps" },
    });
    const happy = stored({
      subject: "Caps is feeling great!",
      subject_key: "be.msg.playerEvent.templates.happy_player_1.subject",
      body_key: "be.msg.playerEvent.templates.happy_player_1.body",
      i18n_params: { player: "Caps", morale: "100" },
    });
    expect((await renderIn("es", bench)).subject).toBe("Caps quiere más minutos");
    expect((await renderIn("es", happy)).subject).toBe("¡Caps está de buen humor!");
  });
});

describe("random event messages render in the active language", () => {
  it("renders a stored-Spanish-or-English podcast in the active language", async () => {
    // podcast_3 is stored Spanish in the data templates; every locale must still own its copy.
    const msg = stored({
      subject: "Al Lío: KOI protagonista del debate",
      subject_key: "be.msg.allio.templates.podcast_3.subject",
      body_key: "be.msg.allio.templates.podcast_3.body",
      i18n_params: { team: "KOI", player: "Caps" },
    });
    expect((await renderIn("en", msg)).subject).toBe("Al Lío: KOI takes centre stage in the debate");
    expect((await renderIn("es", msg)).subject).toBe("Al Lío: KOI protagonista del debate");
    expect((await renderIn("de", msg)).subject).toBe("Al Lío: KOI im Mittelpunkt der Debatte");
  });

  it("renders a stored-English rival interest message in Spanish", async () => {
    const msg = stored({
      subject: "G2 eyeing Caps",
      subject_key: "be.msg.rivalInterest.templates.rival_1.subject",
      body_key: "be.msg.rivalInterest.templates.rival_1.body",
      i18n_params: { player: "Caps", rival: "G2" },
    });
    const resolved = await renderIn("es", msg);
    expect(resolved.subject).toBe("G2 tiene en el punto de mira a Caps");
    expect(resolved.body).toContain("G2 está interesada en Caps");
  });
});
