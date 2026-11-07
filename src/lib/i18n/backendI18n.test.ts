import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import i18n from "../../i18n";
import {
  resolveBackendText,
  resolveMessage,
  resolveAction,
  resolveNewsArticle,
  resolveBoardObjective,
} from "./backendI18n";
import type {
  MessageData,
  MessageAction,
  NewsArticle,
  BoardObjective,
} from "../../store/gameStore";

// ---------------------------------------------------------------------------
// Bootstrap i18n with a test key so we can verify resolution works
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Ensure i18n is initialized (it auto-inits on import) then add test keys
  await i18n.init; // no-op if already initialised
  i18n.addResourceBundle("en", "translation", {
    "test.subject": "Resolved Subject",
    "test.body": "Hello {{name}}, welcome!",
    "test.sender": "The Board",
    "test.senderRole": "Board of Directors",
    "test.actionLabel": "Accept Offer",
    "test.optionLabel": "Encourage them",
    "test.optionDescription": "Show empathy and keep them motivated.",
    "test.headline": "Breaking: {{team}} wins!",
    "test.newsBody": "Match report for {{team}}.",
    "test.source": "OFM Sports",
    "test.recommendation": "Translated recommendation",
    "test.focus": "Translated focus",
    "test.issue": "Translated issue",
    "boardObjectives.objective.LeaguePosition": "Finish in the top {{target}}",
    "boardObjectives.objective.Wins": "Win at least {{target}} series",
    "boardObjectives.objective.GoalsScored": "Win at least {{target}} maps",
  }, true, true);
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

// ---------------------------------------------------------------------------
// Helpers to build minimal test data
// ---------------------------------------------------------------------------

const makeAction = (overrides: Partial<MessageAction> = {}): MessageAction => ({
  id: "act_1",
  label: "raw label",
  action_type: "Acknowledge",
  resolved: false,
  ...overrides,
});

const makeMessage = (overrides: Partial<MessageData> = {}): MessageData => ({
  id: "msg_1",
  subject: "raw subject",
  body: "raw body",
  sender: "raw sender",
  sender_role: "raw role",
  date: "2026-08-01",
  read: false,
  category: "general",
  priority: "normal",
  actions: [],
  context: { team_id: null, player_id: null, fixture_id: null, match_result: null },
  ...overrides,
});

const makeNewsArticle = (overrides: Partial<NewsArticle> = {}): NewsArticle => ({
  id: "news_1",
  headline: "raw headline",
  body: "raw body",
  source: "raw source",
  date: "2026-08-01",
  category: "match",
  team_ids: [],
  player_ids: [],
  match_score: null,
  read: false,
  ...overrides,
});

const makeBoardObjective = (
  overrides: Partial<BoardObjective> = {},
): BoardObjective => ({
  id: "obj_1",
  description: "raw objective",
  target: 4,
  objective_type: "LeaguePosition",
  met: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// resolveAction
// ---------------------------------------------------------------------------

describe("resolveAction", () => {
  it("returns action with resolved label when label_key exists", () => {
    const action = makeAction({ label: "fallback", label_key: "test.actionLabel" });
    const result = resolveAction(action);
    expect(result.label).toBe("Accept Offer");
  });

  it("resolves choose-option labels and descriptions when keys exist", () => {
    const action = makeAction({
      action_type: {
        ChooseOption: {
          options: [
            {
              id: "encourage",
              label: "fallback option",
              description: "fallback description",
              label_key: "test.optionLabel",
              description_key: "test.optionDescription",
            },
          ],
        },
      },
    });

    const result = resolveAction(action);

    if (typeof result.action_type !== "object" || !("ChooseOption" in result.action_type)) {
      throw new Error("Expected ChooseOption action type");
    }

    expect(result.action_type.ChooseOption.options[0].label).toBe("Encourage them");
    expect(result.action_type.ChooseOption.options[0].description).toBe(
      "Show empathy and keep them motivated.",
    );
  });

  it("resolves explicit random-event option keys with message interpolation params", () => {
    i18n.addResourceBundle("en", "translation", {
      be: {
        msg: {
          sponsor: {
            options: {
              accept: {
                label: "Accept the deal",
                description: "Receive €{{amount}} in sponsorship income.",
              },
            },
          },
        },
      },
    }, true, true);

    const result = resolveMessage(makeMessage({
      id: "sponsor_2026-08-01",
      i18n_params: { amount: "250000" },
      actions: [
        makeAction({
          id: "respond",
          label: "Respond",
          action_type: {
            ChooseOption: {
              options: [
                {
                  id: "accept",
                  label: "fallback option",
                  description: "fallback description",
                  label_key: "be.msg.sponsor.options.accept.label",
                  description_key: "be.msg.sponsor.options.accept.description",
                },
              ],
            },
          },
        }),
      ],
    }));

    const actionType = result.actions[0].action_type;

    if (typeof actionType !== "object" || !("ChooseOption" in actionType)) {
      throw new Error("Expected ChooseOption action type");
    }

    expect(actionType.ChooseOption.options[0].label).toBe("Accept the deal");
    expect(actionType.ChooseOption.options[0].description).toBe(
      "Receive €250000 in sponsorship income.",
    );
  });

  it("keeps raw label when label_key is absent", () => {
    const action = makeAction({ label: "Keep Me" });
    const result = resolveAction(action);
    expect(result.label).toBe("Keep Me");
  });

  it("falls back to raw label when key is not found in translations", () => {
    const action = makeAction({ label: "fallback", label_key: "nonexistent.key" });
    const result = resolveAction(action);
    expect(result.label).toBe("fallback");
  });

  it("infers player-event action and option keys for legacy saved messages", () => {
    i18n.addResourceBundle("en", "translation", {
      be: {
        msg: {
          playerEvent: {
            respond: "Custom Respond",
            options: {
              happyPlayer: {
                praiseBack: {
                  label: "Custom Praise Back",
                  description: "Custom praise description.",
                },
              },
            },
          },
        },
      },
    }, true, true);

    const action = makeAction({
      id: "respond",
      label: "Legacy respond",
      action_type: {
        ChooseOption: {
          options: [
            {
              id: "praise_back",
              label: "Legacy praise",
              description: "Legacy description",
            },
          ],
        },
      },
    });

    const result = resolveAction(action, "happy_player_p_fwd0");

    if (typeof result.action_type !== "object" || !("ChooseOption" in result.action_type)) {
      throw new Error("Expected ChooseOption action type");
    }

    expect(result.label).toBe("Custom Respond");
    expect(result.action_type.ChooseOption.options[0].label).toBe("Custom Praise Back");
    expect(result.action_type.ChooseOption.options[0].description).toBe("Custom praise description.");
  });
});

// ---------------------------------------------------------------------------
// resolveMessage
// ---------------------------------------------------------------------------

describe("resolveMessage", () => {
  it("resolves all translatable fields when keys exist", () => {
    const msg = makeMessage({
      subject: "raw", subject_key: "test.subject",
      body: "raw", body_key: "test.body",
      sender: "raw", sender_key: "test.sender",
      sender_role: "raw", sender_role_key: "test.senderRole",
      i18n_params: { name: "Coach" },
      actions: [makeAction({ label: "raw", label_key: "test.actionLabel" })],
    });
    const result = resolveMessage(msg);
    expect(result.subject).toBe("Resolved Subject");
    expect(result.body).toBe("Hello Coach, welcome!");
    expect(result.sender).toBe("The Board");
    expect(result.sender_role).toBe("Board of Directors");
    expect(result.actions[0].label).toBe("Accept Offer");
  });

  it("keeps raw values when no keys are provided", () => {
    const msg = makeMessage({
      subject: "My Subject",
      body: "My Body",
      sender: "Someone",
      sender_role: "Staff",
    });
    const result = resolveMessage(msg);
    expect(result.subject).toBe("My Subject");
    expect(result.body).toBe("My Body");
    expect(result.sender).toBe("Someone");
    expect(result.sender_role).toBe("Staff");
  });

  it("resolves i18n keys passed as message params", () => {
    const msg = makeMessage({
      subject: "raw",
      body: "Recommendation: test.recommendation",
      body_key: "be.msg.scrimWeekly.body",
      i18n_params: {
        played: "2",
        wins: "1",
        losses: "1",
        cancellations: "0",
        avgQuality: "76",
        lossStreak: "1",
        topFocus: "test.focus",
        recurringIssue: "test.issue",
        topChampion: "Azir",
        recommendation: "test.recommendation",
      },
    });

    const result = resolveMessage(msg);

    expect(result.body).toContain("Main focus: Translated focus");
    expect(result.body).toContain("Recurring issue: Translated issue");
    expect(result.body).toContain("Recommendation: Translated recommendation");
  });

  it("resolves board objective review messages with persisted params", () => {
    const msg = makeMessage({
      subject: "Season 1 — Board Objective Review",
      body: "The board has completed its end-of-split objective review. You delivered 1/3 objectives.",
      subject_key: "be.msg.boardObjectiveReview.subject",
      body_key: "be.msg.boardObjectiveReview.body",
      i18n_params: {
        season: "1",
        metCount: "1",
        total: "3",
        satisfactionDelta: "-5",
      },
    });

    const result = resolveMessage(msg);

    expect(result.subject).toBe("Season 1 — Board Objective Review");
    expect(result.body).toContain("You delivered 1/3 objectives.");
    expect(result.body).toContain("Manager satisfaction impact: -5.");
    expect(result.body).toContain("series wins");
    expect(result.body).toContain("map wins");
  });

  it("localizes legacy delegated renewal messages without persisted i18n keys", async () => {
    const previousLanguage = i18n.language;
    await i18n.changeLanguage("pt-BR");

    try {
      const msg = makeMessage({
        id: "delegated_renewals_2026-07-01_0",
        subject: "Assistant Report — Contract Renewals",
        body:
          "Boss, I went through our renewal list at Lisbon Sporting. 4 completed, 2 still pending, 1 failed.\n\nCompleted: Claes agreed to 1 year(s) on €5000/wk.\nStill difficult: Vieira — Their camp want around €25000/wk for 3 years, which is beyond the delegation limits.\nFailed: Fernandes — You told me not to reopen contract talks yet.",
        sender: "Assistant Manager",
        sender_role: "Assistant Manager",
      });

      const result = resolveMessage(msg);

      expect(result.subject).toBe(
        "Relatório do assistente — Renovações contratuais",
      );
      expect(result.sender).toBe("Auxiliar Técnico");
      expect(result.sender_role).toBe("Auxiliar Técnico");
      expect(result.body).toContain(
        "Chefe, revisei nossa lista de renovações no Lisbon Sporting. 4 concluídas, 2 ainda pendentes e 1 falhas.",
      );
      expect(result.body).toContain(
        "Concluída: Claes aceitou 1 ano(s) por €5000/ano.",
      );
      expect(result.body).toContain(
        "Continua difícil: Vieira — O estafe deles quer cerca de €25000/ano por 3 anos, acima dos limites da delegação.",
      );
      expect(result.body).toContain(
        "Falhou: Fernandes — Você me disse para ainda não reabrir as conversas contratuais.",
      );
    } finally {
      await i18n.changeLanguage(previousLanguage);
    }
  });

  it("preserves non-translatable fields", () => {
    const msg = makeMessage({ id: "msg_99", read: true, category: "transfer" });
    const result = resolveMessage(msg);
    expect(result.id).toBe("msg_99");
    expect(result.read).toBe(true);
    expect(result.category).toBe("transfer");
  });
});

// ---------------------------------------------------------------------------
// resolveNewsArticle
// ---------------------------------------------------------------------------

describe("resolveNewsArticle", () => {
  it("resolves all translatable fields with params", () => {
    const article = makeNewsArticle({
      headline: "raw", headline_key: "test.headline",
      body: "raw", body_key: "test.newsBody",
      source: "raw", source_key: "test.source",
      i18n_params: { team: "Test FC" },
    });
    const result = resolveNewsArticle(article);
    expect(result.headline).toBe("Breaking: Test FC wins!");
    expect(result.body).toBe("Match report for Test FC.");
    expect(result.source).toBe("OFM Sports");
  });

  it("keeps raw values when no keys are provided", () => {
    const article = makeNewsArticle({
      headline: "Big News",
      body: "Details here",
      source: "Press",
    });
    const result = resolveNewsArticle(article);
    expect(result.headline).toBe("Big News");
    expect(result.body).toBe("Details here");
    expect(result.source).toBe("Press");
  });

  it("localizes legacy weekly digest headlines that still carry an English weekLabel param", async () => {
    const previousLanguage = i18n.language;
    await i18n.changeLanguage("pt-BR");

    try {
      const article = makeNewsArticle({
        headline: "Weekly Digest — Week of 2026-07-27",
        headline_key: "be.news.weeklyDigest.headline",
        i18n_params: { weekLabel: "Week of 2026-07-27" },
      });

      const result = resolveNewsArticle(article);

      expect(result.headline).toBe("Power rankings semanal — semana de 2026-07-27");
    } finally {
      await i18n.changeLanguage(previousLanguage);
    }
  });

  it("preserves non-translatable fields", () => {
    const article = makeNewsArticle({ id: "n_5", category: "transfer", read: true });
    const result = resolveNewsArticle(article);
    expect(result.id).toBe("n_5");
    expect(result.category).toBe("transfer");
    expect(result.read).toBe(true);
  });
});

describe("resolveBoardObjective", () => {
  it("resolves objective text from objective_type and target", () => {
    const objective = makeBoardObjective({
      description: "boardObjectives.objective.LeaguePosition",
      target: 6,
      objective_type: "LeaguePosition",
    });

    const result = resolveBoardObjective(objective);

    expect(result.description).toBe("Finish in the top 6");
  });

  it("uses esports terminology for map-win objectives", () => {
    const objective = makeBoardObjective({
      target: 8,
      objective_type: "GoalsScored",
    });

    const result = resolveBoardObjective(objective);

    expect(result.description).toBe("Win at least 8 maps");
  });

  it("falls back to raw description for unknown objective types", () => {
    const objective = makeBoardObjective({
      description: "Custom target",
      objective_type: "CustomObjective",
    });

    const result = resolveBoardObjective(objective);

    expect(result.description).toBe("Custom target");
  });
});

describe("resolveBackendText", () => {
  it("resolves backend effect keys with params", () => {
    i18n.addResourceBundle("en", "translation", {
      "test.effect": "Morale {{delta}}",
    }, true, true);

    const result = resolveBackendText("test.effect", "fallback", { delta: "+3" });

    expect(result).toBe("Morale +3");
  });
});


describe("transfer offer message locale", () => {
  const offer = {
    id: "offer_o1",
    subject: "Transfer offer received for ToniOP",
    body: "English template text",
    sender: "Director of Football",
    sender_role: "Director",
    date: "2027-01-10",
    read: false,
    category: "Transfer",
    priority: "High",
    actions: [],
    context: { team_id: null, player_id: null },
    subject_key: "be.msg.transferOffer.subject",
    body_key: "be.msg.transferOffer.body",
    i18n_params: { player: "ToniOP", club: "Fnatic", buyer: "Fnatic", fee: "\u20ac172K" },
  } as unknown as MessageData;

  it("renders the stored message in the active language with a single currency symbol", async () => {
    await i18n.changeLanguage("es");
    const resolved = resolveMessage(offer);
    await i18n.changeLanguage("en");
    expect(resolved.subject).toBe("Oferta recibida por ToniOP");
    expect(resolved.body).toContain("Fnatic");
    expect(resolved.body).toContain("\u20ac172K");
    expect(resolved.body).not.toContain("\u20ac\u20ac");
  });
});

describe("first-week message locale", () => {
  const schedule = {
    id: "season_1",
    subject: "LEC Winter season confirmed",
    body: "The fixture list for the upcoming LEC Winter season has been confirmed. The action begins on January 18, 2026.",
    sender: "Board of Directors",
    sender_role: "Chairman",
    date: "2026-01-01",
    read: false,
    category: "LeagueInfo",
    priority: "Normal",
    actions: [],
    context: { team_id: null, player_id: null },
    subject_key: "be.msg.schedule.templates.schedule_2.subject",
    body_key: "be.msg.schedule.templates.schedule_2.body",
    i18n_params: { league: "LEC Winter", start: "2026-01-18" },
  } as unknown as MessageData;

  it("renders a stored-English season schedule in Spanish with the ISO date formatted for es", async () => {
    await i18n.changeLanguage("es");
    const resolved = resolveMessage(schedule);
    await i18n.changeLanguage("en");
    expect(resolved.subject).toBe("Temporada de LEC Winter confirmada");
    expect(resolved.body).toContain("18 de enero de 2026");
    expect(resolved.body).not.toContain("2026-01-18");
  });

  it("formats the same ISO date for English", () => {
    const resolved = resolveMessage(schedule);
    expect(resolved.body).toContain("January 18, 2026");
  });

  it("translates the staff advice and academy overview from keys", async () => {
    const staff = makeMessage({
      subject: "Staff vacancies at Movistar KOI",
      subject_key: "be.msg.staffAdvice.templates.staff_advice.subject",
      body_key: "be.msg.staffAdvice.templates.staff_advice.body",
      i18n_params: { team: "Movistar KOI" },
    });
    const academy = makeMessage({
      subject: "Academy active: KOI Academy",
      subject_key: "be.msg.academyOverview.subject",
      body_key: "be.msg.academyOverview.body",
      i18n_params: { academy: "KOI Academy", count: "7" },
    });
    await i18n.changeLanguage("es");
    const staffEs = resolveMessage(staff);
    const academyEs = resolveMessage(academy);
    await i18n.changeLanguage("en");
    expect(staffEs.subject).toBe("Vacantes de personal en Movistar KOI");
    expect(academyEs.subject).toBe("Academia activa: KOI Academy");
    expect(academyEs.body).toContain("7 prospectos");
  });
});
