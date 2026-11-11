import { beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import { buildPressConferenceQuestions } from "./pressConferenceContent";

const SERIES_QUESTION_KEY = "content.lol.social.questions.playoffBestOfSeries.text";

function makeSnapshot(): MatchSnapshot {
  return {
    phase: "FullTime",
    current_minute: 35,
    home_score: 1,
    away_score: 0,
    home_team: { id: "fnc", name: "Fnatic", draft_strategy: "Objective control", players: [] },
    away_team: { id: "g2", name: "G2 Esports", draft_strategy: "Skirmish", players: [] },
    events: [],
  } as unknown as MatchSnapshot;
}

function makeGameState(): GameStateData {
  return {
    manager: { id: "mgr", team_id: "fnc" },
    teams: [],
    players: [],
    staff: [],
    leagues: [{ id: "default", name: "LEC", season: 1, fixtures: [], standings: [] }],
  } as unknown as GameStateData;
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Every question the press asks over many seeded draws for the given series length. */
function askedQuestions(seriesLength: number | undefined): string[] {
  const asked: string[] = [];
  for (let seed = 1; seed <= 120; seed += 1) {
    for (const userResult of ["win", "loss"] as const) {
      const questions = buildPressConferenceQuestions({
        snapshot: makeSnapshot(),
        gameState: makeGameState(),
        userSide: "Home",
        t: i18n.t.bind(i18n),
        random: seeded(seed),
        userResult,
        seriesLength,
      });
      asked.push(...questions.map((question) => question.question));
    }
  }
  return asked;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("press conference series questions", () => {
  const seriesText = () => i18n.t(SERIES_QUESTION_KEY);

  it("never asks about adapting between maps after a single game", () => {
    expect(askedQuestions(1)).not.toContain(seriesText());
  });

  it("does not ask the series question when the series format is not known", () => {
    expect(askedQuestions(undefined)).not.toContain(seriesText());
  });

  it("still asks the series question after a best-of-three or best-of-five", () => {
    expect(askedQuestions(3)).toContain(seriesText());
    expect(askedQuestions(5)).toContain(seriesText());
  });
});
