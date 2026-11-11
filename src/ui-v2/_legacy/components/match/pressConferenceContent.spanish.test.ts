import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import { buildPressConferenceQuestions } from "./pressConferenceContent";

const ENGLISH_NAMES = [
  "Sideline Human Angle",
  "LEC Post-Match Interviews",
  "Verified Analyst",
  "Draft Room Critic",
  "The Rift Instigator",
  "League Beat",
  "Tactical Rift Review",
  "Rift Desk",
];

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

/** Deterministic pseudo-random sequence so that every eligible persona gets drawn. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("press conference journalists and outlets in the Spanish UI", () => {
  it("names the journalist and the outlet in Spanish", () => {
    const names = new Set<string>();
    for (let seed = 1; seed <= 80; seed += 1) {
      for (const userResult of ["win", "loss"] as const) {
        const questions = buildPressConferenceQuestions({
          snapshot: makeSnapshot(),
          gameState: makeGameState(),
          userSide: "Home",
          t: i18n.t.bind(i18n),
          random: seeded(seed),
          userResult,
        });
        for (const question of questions) {
          names.add(question.journalist);
          names.add(question.outlet);
        }
      }
    }

    expect(names.size).toBeGreaterThan(4);
    expect(names).toContain("Ángulo humano desde la banda");
    expect(names).toContain("Entrevistas postpartido de la LEC");
    for (const english of ENGLISH_NAMES) {
      expect(names, english).not.toContain(english);
    }
  });

  it("keeps the pack's own names when a locale has no entry for them", () => {
    const questions = buildPressConferenceQuestions({
      snapshot: makeSnapshot(),
      gameState: makeGameState(),
      userSide: "Home",
      t: (key: string) => key,
      random: seeded(7),
      userResult: "win",
    });

    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.journalist).not.toMatch(/^content\.lol/);
      expect(question.outlet).not.toMatch(/^content\.lol/);
    }
  });
});
