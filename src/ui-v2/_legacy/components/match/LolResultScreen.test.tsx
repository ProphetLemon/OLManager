import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import LolResultScreen from "@/ui-v2/_legacy/components/match/LolResultScreen";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { GameStateData } from "@/store/gameStore";

function champion(id: string, team: "blue" | "red", name: string, damageDealt?: number) {
  return {
    id,
    name,
    team,
    role: "MID",
    kills: 2,
    deaths: 1,
    assists: 3,
    cs: 150,
    gold: 900,
    spentGold: 8000,
    ...(damageDealt === undefined ? {} : { damageDealt }),
  };
}

function runtime(overrides: Record<string, unknown> = {}): LolSimV1RuntimeState {
  const events = Array.from({ length: 8 }, (_, i) => ({
    t: 60 * (i + 1),
    text: "Minion wave spawned",
    type: "spawn",
    code: "wave_spawned",
  }));
  return {
    timeSec: 1800,
    running: false,
    winner: "blue",
    champions: [champion("b-mid", "blue", "Zed", 23456), champion("r-mid", "red", "Ahri", 18100)],
    stats: {
      blue: { kills: 10, towers: 8, dragons: 3, barons: 1, gold: 60000 },
      red: { kills: 4, towers: 2, dragons: 1, barons: 0, gold: 50000 },
    },
    events: [
      ...events,
      { t: 600, text: "Zed killed Ahri", type: "kill", code: "champion_killed", data: { actor: "Zed", target: "Ahri" } },
      { t: 1790, text: "BLUE destroyed red-nexus", type: "nexus", code: "structure_destroyed", data: { team: "blue", structure: "red-nexus" } },
    ],
    objectives: { dragon: { currentKind: "ocean", homeStacks: 3, awayStacks: 1, soulClaimedBy: null } },
    ...overrides,
  } as unknown as LolSimV1RuntimeState;
}

const snapshot = {
  home_team: { id: "h", name: "Alpha FC", players: [] },
  away_team: { id: "a", name: "Beta FC", players: [] },
  current_minute: 30,
} as unknown as MatchSnapshot;

function renderScreen(state: LolSimV1RuntimeState) {
  return render(
    <LolResultScreen
      snapshot={snapshot}
      gameState={{} as GameStateData}
      userSide="Home"
      importantEvents={[]}
      finalRuntimeState={state}
      onPressConference={vi.fn()}
      onFinish={vi.fn()}
    />,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("es");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("LolResultScreen in the Spanish UI", () => {
  it("writes the key timeline in Spanish from each event's code and data", () => {
    renderScreen(runtime());
    expect(screen.getByText("Zed eliminó a Ahri")).toBeInTheDocument();
    expect(screen.getByText("Azul destruyó el nexo")).toBeInTheDocument();
    expect(screen.queryByText(/killed|destroyed|spawned/)).toBeNull();
  });

  it("shows the damage each champion dealt", () => {
    renderScreen(runtime());
    const damage = screen.getAllByTestId("row-damage").map((node) => node.textContent);
    expect(damage).toEqual(["23.5k", "18.1k"].map((value) => value.replace(".", ",")));
  });

  it("shows a dash, not a zero, for damage the state did not record", () => {
    renderScreen(runtime({ champions: [champion("b-mid", "blue", "Zed")] }));
    const [cell] = screen.getAllByTestId("row-damage");
    expect(cell).toHaveTextContent("-");
    expect(within(cell).queryByText("0")).toBeNull();
  });

  it("keeps the English line of events saved before they had a code", () => {
    const old = runtime({
      events: Array.from({ length: 8 }, (_, i) => ({ t: 60 * (i + 1), text: `BLUE secured baron ${i}`, type: "baron" })),
    });
    renderScreen(old);
    expect(screen.getByText("BLUE secured baron 7")).toBeInTheDocument();
  });
});
