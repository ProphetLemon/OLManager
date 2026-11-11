import { describe, expect, it } from "vitest";
import { SOCIAL_CONTENT_PACK } from "./content";
import { validateSocialContent } from "./schema";

describe("SOCIAL_CONTENT_PACK", () => {
  it("assembles source-controlled JSON packs into a valid schemaVersion 1 registry", () => {
    expect(SOCIAL_CONTENT_PACK.schemaVersion).toBe(1);
    expect(SOCIAL_CONTENT_PACK.outlets.map((outlet) => outlet.id)).toEqual(
      expect.arrayContaining([
        "sheep-esports",
        "league-beat",
        "dot-esports-lol",
        "lec-post-match",
      ]),
    );
    expect(SOCIAL_CONTENT_PACK.personas.map((persona) => ({
      id: persona.id,
      type: persona.type,
      allowedTones: persona.allowedTones,
    }))).toEqual(
      expect.arrayContaining([
        {
          id: "verified-analyst",
          type: "fictional",
          allowedTones: ["analytical", "professional"],
        },
        {
          id: "sideline-human",
          type: "inspired",
          allowedTones: ["professional", "community", "close"],
        },
        {
          id: "rift-instigator",
          type: "fictional",
          allowedTones: ["spicy", "pressure", "dramatic"],
        },
      ]),
    );
    expect(SOCIAL_CONTENT_PACK.news.map((template) => template.id)).toEqual(
      [
        "league-roundup-maps",
        "standings-power-rankings",
        "season-preview-split",
        "weekly-digest-social-buzz",
      ],
    );
    expect(validateSocialContent(SOCIAL_CONTENT_PACK)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("integrates LEC press conference questions using only reachable match context tags or facts", () => {
    const reachableMatchTags = new Set([
      "win",
      "loss",
      "stomp",
      "stomped",
      "close_game",
      "objective_domination",
      "objective_control",
      "comeback",
      "neutral_objectives",
      "underperformance",
      "decisive_mistake",
      "first_blood",
      "first_blood_for_us",
      "first_blood_against_us",
      "draft",
      "early_game",
      "mid_game",
      "late_game",
      "mvp",
      "mvp_carry",
      "role_top",
      "role_mid",
      "role_jungle",
      "role_adc",
      "role_support",
      "botlane_underperformed",
      "rivalry",
      "streak_win",
      "streak_loss",
    ]);
    const reachableMatchFacts = new Set([
      "result",
      "userSide",
      "durationMinutes",
      "killDiff",
      "killShare",
      "objectiveDiff",
      "objectiveLead",
      "leagueId",
      "seriesLength",
      "comebackGoldDeficit",
      "firstBloodSide",
      "strongSide",
      "timing",
      "mvpPlayerId",
      "mvpRole",
      "worstPlayerId",
      "worstRole",
      "streakCount",
    ]);

    expect(SOCIAL_CONTENT_PACK.questions.map((question) => question.id)).toEqual(
      expect.arrayContaining([
        "baron-control-win",
        "baron-throw-loss",
        "stomp-loss-accountability",
        "rivalry-week-pressure",
      ]),
    );

    const unknownSignals = SOCIAL_CONTENT_PACK.questions.flatMap((question) => [
      ...(question.requiredTags ?? []).filter((tag) => !reachableMatchTags.has(tag)),
      ...(question.excludedTags ?? []).filter((tag) => !reachableMatchTags.has(tag)),
      ...(question.requiredFacts ?? []).filter((fact) => !reachableMatchFacts.has(fact)),
      ...(question.excludedFacts ?? []).filter((fact) => !reachableMatchFacts.has(fact)),
    ]);

    expect(unknownSignals).toEqual([]);
  });

  it("preserves gameplay effect IDs on every selectable response", () => {
    expect(
      SOCIAL_CONTENT_PACK.responses.map((response) => ({
        id: response.id,
        effectId: response.effectId,
        target: response.target,
      })),
    ).toEqual(expect.arrayContaining([
      {
        id: "credit-preparation",
        effectId: "press_squad_morale_small_up",
        target: "squad",
      },
      {
        id: "demand-reset",
        effectId: "press_player_pressure_small_down",
        target: "player",
      },
      { id: "stay-measured", effectId: "press_no_effect", target: "none" },
      { id: "take-responsibility", effectId: "press_squad_morale_small_up", target: "squad" },
    ]));
  });

  it("preserves LoL news/social template metadata for backend news migration", () => {
    expect(
      SOCIAL_CONTENT_PACK.news.map((template) => ({
        id: template.id,
        templateKey: template.templateKey,
        tags: template.tags,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          id: "league-roundup-maps",
          templateKey: "be.news.roundup.body",
          tags: ["roundup", "maps"],
        },
      ]),
    );
  });
});
