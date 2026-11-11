import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PressConference from "@/ui-v2/_legacy/components/match/PressConference";
import { mapRuntimeEventsToMatchEvents, mergeRuntimeEventsIntoSnapshot } from "@/ui-v2/_legacy/components/match/matchRuntimeEvents";
import { buildPressConferenceQuestions } from "@/ui-v2/_legacy/components/match/pressConferenceContent";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { GameStateData } from "@/store/gameStore";

import { invoke } from "@tauri-apps/api/core";
import { SOCIAL_CONTENT_PACK } from "@/content/lol/social/content";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "content.lol.social.questions.cleanWinObjectives.text":
          "Your bot lane stacked dragons and controlled Baron. How much of this win came from objective setup?",
        "content.lol.social.questions.underperformancePressure.text":
          "Your bot lane struggled under pressure tonight. Is this becoming a pattern?",
        "content.lol.social.questions.resultWin.text":
          "You closed the Nexus cleanly. What decided the series?",
        "content.lol.social.questions.firstBlood.text":
          "First blood set the tone here. How much did that early advantage matter?",
        "content.lol.social.questions.closeGame.text":
          "This was a nail-biter down to the final minute. What kept you focused?",
        "content.lol.social.responses.creditPreparation.label": "Professional",
        "content.lol.social.responses.creditPreparation.text":
          "The players earned that through draft prep and clean objective calls.",
        "content.lol.social.responses.demandReset.label": "Demand reset",
        "content.lol.social.responses.demandReset.text":
          "We have to reset standards immediately; pressure is part of playing at this level.",
        "content.lol.social.responses.takeResponsibility.label": "Take responsibility",
        "content.lol.social.responses.takeResponsibility.text":
          "We own this result. The team will review it and come back stronger.",
        "content.lol.social.responses.stayMeasured.label": "Stay measured",
        "content.lol.social.responses.stayMeasured.text":
          "One result does not define our form. We review it and move forward.",
        "content.lol.social.questions.mentalResetAfterLoss.text":
          "This loss stings. How do you reset the squad mentally before the next match?",
        "match.pressConference": "Press Conference",
        "match.pressSubtitle": "Post-match media for Fnatic",
        "match.nextQuestion": "Next Question",
        "match.leaveConference": "Leave Conference",
        "match.skipConference": "Skip Conference",
        "match.submitting": "Submitting",
        "match.pressReport.headlineManagerQuote": "Manager quote",
        "match.pressReport.headlinePressConf": "Press conference",
        "match.pressReport.headlinePostMatch": "Post match",
        "match.pressReport.bodySingle": "Single quote body",
        "match.pressReport.bodyIntro": "Intro",
        "match.pressReport.bodyOutro": "Outro",
        "match.pressReport.bodyNone": "No comments",
      };
      return translations[key] ?? key;
    },
  }),
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function makePlayer(id: string, name: string, position = "ADC") {
  return {
    id,
    name,
    position,
    condition: 90,
    fitness: 90,
    mechanics: 70,
    laning: 70,
    teamfighting: 70,
    macro_play: 70,
    consistency: 70,
    shotcalling: 60,
    champion_pool: 70,
    discipline: 70,
    mental_resilience: 70,
    pace: 70,
    stamina: 70,
    strength: 60,
    agility: 70,
    passing: 70,
    shooting: 70,
    tackling: 40,
    dribbling: 70,
    defending: 40,
    positioning: 70,
    vision: 70,
    decisions: 70,
    composure: 70,
    aggression: 50,
    teamwork: 70,
    leadership: 60,
    handling: 20,
    reflexes: 20,
    aerial: 50,
    traits: [],
  };
}

function makeSnapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    phase: "FullTime",
    current_minute: 35,
    home_score: 1,
    away_score: 0,
    possession: "Home",
    ball_zone: "Midfield",
    home_team: {
      id: "fnc",
      name: "Fnatic",
      draft_strategy: "Objective control",
      players: [makePlayer("adc1", "Rekkles", "ADC"), makePlayer("sup1", "Support", "SUPPORT")],
    },
    away_team: {
      id: "g2",
      name: "G2 Esports",
      draft_strategy: "Skirmish",
      players: [makePlayer("enemy1", "Hans", "ADC")],
    },
    home_bench: [],
    away_bench: [],
    home_possession_pct: 55,
    away_possession_pct: 45,
    events: [],
    home_subs_made: 0,
    away_subs_made: 0,
    max_subs: 0,
    home_roles: { captain: null, shotcaller: null },
    away_roles: { captain: null, shotcaller: null },
    substitutions: [],
    allows_extra_time: false,
    home_yellows: {},
    away_yellows: {},
    sent_off: [],
    ...overrides,
  };
}

function makeGameState(): GameStateData {
  return {
    clock: { current_date: "2026-04-25", start_date: "2026-01-01" },
    manager: {
      id: "mgr",
      first_name: "Test",
      last_name: "Manager",
      date_of_birth: "1990-01-01",
      nationality: "ES",
      reputation: 50,
      satisfaction: 50,
      fan_approval: 50,
      team_id: "fnc",
      career_stats: { matches: 0, wins: 0, losses: 0, trophies: 0, matches_managed: 0, best_finish: null },
      career_history: [],
    },
    teams: [],
    players: [],
    staff: [],
    messages: [],
    news: [],
    leagues: [{ id: "default", name: "LEC", season: 1, fixtures: [], standings: [] }],
    scouting_assignments: [],
    board_objectives: [],
  };
}

function uniqueQuestionIds(questions: ReturnType<typeof buildPressConferenceQuestions>): string[] {
  return [...new Set(questions.map((question) => question.id))];
}

function makeObjectiveWinSnapshot(): MatchSnapshot {
  return makeSnapshot({
    events: [
      { minute: 10, event_type: "Dragon", side: "Home", zone: "River", player_id: "adc1", secondary_player_id: null },
      { minute: 14, event_type: "Baron", side: "Home", zone: "River", player_id: "sup1", secondary_player_id: null },
    ],
  });
}

function answerCurrentQuestion() {
  const responseButton = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.includes('"') && !button.hasAttribute("disabled"));

  expect(responseButton).toBeDefined();
  fireEvent.click(responseButton!);
}

describe("PressConference LoL social content", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({ game: makeGameState(), morale_delta: 3 });
    vi.spyOn(Math, "random").mockReturnValue(0);
    window.localStorage.clear();
  });

  it("buildPressConferenceQuestions reacts to objective events in snapshot.events", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeObjectiveWinSnapshot(),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions).toHaveLength(3);
    expect(questions[0].id).toBe("clean-win-objectives");
    expect(uniqueQuestionIds(questions)).toHaveLength(questions.length);
  });

  it("excludes recent question IDs when alternatives exist", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeObjectiveWinSnapshot(),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0,
      recentQuestionIds: ["clean-win-objectives"],
      // A best-of-three: the series question is the third alternative once the recent one is excluded.
      seriesLength: 3,
    });

    expect(questions).toHaveLength(3);
    expect(questions.map((question) => question.id)).not.toContain("clean-win-objectives");
    expect(uniqueQuestionIds(questions)).toHaveLength(questions.length);
  });

  it("falls back to the eligible pool when every candidate is recent", () => {
    const allQuestionIds = SOCIAL_CONTENT_PACK.questions.map((question) => question.id);
    const questions = buildPressConferenceQuestions({
      snapshot: makeObjectiveWinSnapshot(),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0,
      recentQuestionIds: allQuestionIds,
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0].id).toBe("clean-win-objectives");
    expect(uniqueQuestionIds(questions)).toHaveLength(questions.length);
  });

  it("does not duplicate question IDs within one generated conference", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeObjectiveWinSnapshot(),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0.99,
    });

    expect(questions.length).toBeGreaterThan(1);
    expect(uniqueQuestionIds(questions)).toHaveLength(questions.length);
  });

  it("returns valid questions for common win and loss snapshots", () => {
    const winQuestions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({ home_score: 2, away_score: 0 }),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0,
    });
    const lossQuestions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({ home_score: 0, away_score: 2 }),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(winQuestions.length).toBeGreaterThan(0);
    expect(lossQuestions.length).toBeGreaterThan(0);
    expect(winQuestions.every((question) => question.id && question.question && question.responses.length > 0)).toBe(true);
    expect(lossQuestions.every((question) => question.id && question.question && question.responses.length > 0)).toBe(true);
    expect(uniqueQuestionIds(winQuestions)).toHaveLength(winQuestions.length);
    expect(uniqueQuestionIds(lossQuestions)).toHaveLength(lossQuestions.length);
  });

  it("does not surface loss-framed questions after a clear win", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({
        home_score: 3,
        away_score: 0,
        events: [
          { minute: 5, event_type: "Kill", side: "Home", zone: "Top", player_id: "adc1", secondary_player_id: null },
          { minute: 10, event_type: "Dragon", side: "Home", zone: "River", player_id: "adc1", secondary_player_id: null },
          { minute: 16, event_type: "Baron", side: "Home", zone: "River", player_id: "sup1", secondary_player_id: null },
        ],
      }),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => !question.id.toLowerCase().includes("loss"))).toBe(true);
    expect(questions.every((question) => !question.id.toLowerCase().includes("underperformance"))).toBe(true);
  });

  it("selects the first-blood question from a real runtime event merged into the snapshot", () => {
    const snapshotWithRuntimeEvents = mergeRuntimeEventsIntoSnapshot(makeSnapshot(), [
      { t: 180, type: "kill", text: "FIRST BLOOD - BLUE bot lane killed RED ADC" },
    ]);

    const questions = buildPressConferenceQuestions({
      snapshot: snapshotWithRuntimeEvents,
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0.3,
    });

    expect(snapshotWithRuntimeEvents.events).toEqual([
      { minute: 3, event_type: "FirstBlood", side: "Home", zone: "mid", player_id: null, secondary_player_id: null },
    ]);
    expect(questions.map((question) => question.id)).toContain("first-blood-impact");
  });

  it("maps runtime events into MatchSnapshot-compatible events without replacing existing events", () => {
    const baseSnapshot = makeSnapshot({
      events: [
        { minute: 1, event_type: "Kill", side: "Away", zone: "Top", player_id: null, secondary_player_id: null },
      ],
    });

    const runtimeEvents = mapRuntimeEventsToMatchEvents([
      { t: 600, type: "dragon", text: "BLUE secured Infernal Dragon" },
      { t: 1500, type: "baron", text: "RED secured Baron Nashor" },
    ]);
    const merged = mergeRuntimeEventsIntoSnapshot(baseSnapshot, [
      { t: 600, type: "dragon", text: "BLUE secured Infernal Dragon" },
      { t: 1500, type: "baron", text: "RED secured Baron Nashor" },
    ]);

    expect(runtimeEvents.map((event) => [event.minute, event.event_type, event.side])).toEqual([
      [10, "Dragon", "Home"],
      [25, "Baron", "Away"],
    ]);
    expect(merged.events).toHaveLength(3);
    expect(merged.events.slice(1)).toEqual(runtimeEvents);
  });

  it("excludes false-premise win praise when the match context is a botlane loss", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({
        home_score: 0,
        away_score: 1,
        events: Array.from({ length: 7 }, (_, index) => ({
          minute: index + 1,
          event_type: "Death",
          side: "Home" as const,
          zone: "Bot",
          player_id: index % 2 === 0 ? "adc1" : "sup1",
          secondary_player_id: null,
        })),
      }),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0].id).toBe("underperformance-pressure");
    expect(questions[0].question).toContain("underperformancePressure");
  });

  it("persists a scoped recent question history after rendering", async () => {
    render(
        <PressConference
          snapshot={makeObjectiveWinSnapshot()}
          gameState={makeGameState()}
          userSide="Home"
          onFinish={vi.fn()}
        />
    );

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem("olmanager:match:pressConference:recentQuestionIds") ?? "[]",
      );
      expect(stored).toContain("clean-win-objectives");
      expect(stored).toHaveLength(3);
    });
  });

  it("submits stable effect_id values while preserving text for news generation", async () => {
    render(
        <PressConference
          snapshot={makeObjectiveWinSnapshot()}
          gameState={makeGameState()}
          userSide="Home"
          onFinish={vi.fn()}
        />,
    );

    for (let index = 0; index < 3; index += 1) {
      answerCurrentQuestion();
      fireEvent.click(screen.getByRole("button", { name: index === 2 ? /Leave Conference/i : /Next Question/i }));
    }

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const submitArgs = vi.mocked(invoke).mock.calls[0][1] as { answers: Array<Record<string, string>> };
    expect(submitArgs.answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          question_id: "clean-win-objectives",
          response_id: "credit-preparation",
          effect_id: "press_squad_morale_small_up",
          response_text: "The players earned that through draft prep and clean objective calls.",
          question_text: expect.stringContaining(
            "Your bot lane stacked dragons and controlled Baron. How much of this win came from objective setup?",
          ),
        }),
      ]),
    );
  });

  it("uses explicit winnerSide/context to frame questions as a win even when snapshot scores are 0-0", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({ home_score: 0, away_score: 0, events: [] }),
      gameState: makeGameState(),
      userSide: "Home",
      controlledSide: "blue",
      winnerSide: "blue",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => !question.id.toLowerCase().includes("loss"))).toBe(true);
    expect(questions.every((question) => !question.id.toLowerCase().includes("underperformance"))).toBe(true);
  });

  it("keeps result screen and press context aligned when winnerSide matches the displayed result", () => {
    const snapshot = makeSnapshot({ home_score: 0, away_score: 1 });
    const pressQuestions = buildPressConferenceQuestions({
      snapshot,
      gameState: makeGameState(),
      userSide: "Home",
      controlledSide: "red",
      winnerSide: "red",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(pressQuestions.length).toBeGreaterThan(0);
    expect(pressQuestions.every((question) => !question.id.toLowerCase().includes("loss"))).toBe(true);
    expect(pressQuestions.every((question) => !question.id.toLowerCase().includes("underperformance"))).toBe(true);
  });

  it("recognises a win when the canonical home team controls red side and wins red", () => {
    const snapshot = makeSnapshot({ home_score: 0, away_score: 1 });
    const questions = buildPressConferenceQuestions({
      snapshot,
      gameState: makeGameState(),
      userSide: "Home",
      controlledSide: "red",
      winnerSide: "red",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => !question.id.toLowerCase().includes("loss"))).toBe(true);
    expect(questions.every((question) => !question.id.toLowerCase().includes("underperformance"))).toBe(true);
  });

  it("excludes win-framed questions from loss contexts", () => {
    const lossQuestions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({ home_score: 1, away_score: 0 }),
      gameState: makeGameState(),
      userSide: "Home",
      controlledSide: "red",
      winnerSide: "blue",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(lossQuestions.length).toBeGreaterThan(0);
    expect(lossQuestions.every((question) => !question.id.toLowerCase().includes("win"))).toBe(true);
    expect(lossQuestions.every((question) => !question.id.toLowerCase().includes("objective-domination"))).toBe(true);
    expect(lossQuestions.every((question) => !question.id.toLowerCase().includes("clean-win"))).toBe(true);
  });

  it("attributes Home-side events to the user when canonical Home controls red", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({
        home_score: 1,
        away_score: 0,
        events: [
          { minute: 10, event_type: "Dragon", side: "Home", zone: "River", player_id: "adc1", secondary_player_id: null },
          { minute: 14, event_type: "Baron", side: "Home", zone: "River", player_id: "sup1", secondary_player_id: null },
        ],
      }),
      gameState: makeGameState(),
      userSide: "Home",
      controlledSide: "red",
      winnerSide: "red",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions.map((question) => question.id)).toContain("clean-win-objectives");
    expect(questions.every((question) => !question.id.toLowerCase().includes("loss"))).toBe(true);
  });

  it("attributes Away-side events to the user when canonical Away controls blue", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({
        home_score: 0,
        away_score: 1,
        events: [
          { minute: 10, event_type: "Dragon", side: "Away", zone: "River", player_id: "enemy1", secondary_player_id: null },
          { minute: 14, event_type: "Baron", side: "Away", zone: "River", player_id: "enemy1", secondary_player_id: null },
        ],
      }),
      gameState: makeGameState(),
      userSide: "Away",
      controlledSide: "blue",
      winnerSide: "blue",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions.map((question) => question.id)).toContain("clean-win-objectives");
    expect(questions.every((question) => !question.id.toLowerCase().includes("loss"))).toBe(true);
  });

  it("does not misattribute enemy objectives to the user under controlled-side swaps", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({
        home_score: 1,
        away_score: 0,
        events: [
          { minute: 10, event_type: "Dragon", side: "Away", zone: "River", player_id: "enemy1", secondary_player_id: null },
          { minute: 14, event_type: "Baron", side: "Away", zone: "River", player_id: "enemy1", secondary_player_id: null },
        ],
      }),
      gameState: makeGameState(),
      userSide: "Home",
      controlledSide: "red",
      winnerSide: "red",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions.map((question) => question.id)).not.toContain("clean-win-objectives");
  });

  it("regression: live red win is framed as a user win when canonical Home controls red", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeSnapshot({ home_score: 1, away_score: 0 }),
      gameState: makeGameState(),
      userSide: "Home",
      controlledSide: "red",
      winnerSide: "red",
      t: (key: string) => key,
      random: () => 0,
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => !question.id.toLowerCase().includes("loss"))).toBe(true);
    expect(questions.every((question) => !question.id.toLowerCase().includes("underperformance"))).toBe(true);
  });

});
