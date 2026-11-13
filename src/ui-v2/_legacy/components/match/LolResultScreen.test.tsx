import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import LolResultScreen, { sideFromEvent } from "@/ui-v2/_legacy/components/match/LolResultScreen";
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

  it("shows the gold each champion earned (gold in hand plus gold spent), compact", () => {
    renderScreen(runtime());
    const gold = screen.getAllByTestId("row-gold").map((node) => node.textContent);
    expect(gold).toEqual(["8,9k", "8,9k"]);
  });

  it("shows the gold in hand for a champion whose state has no gold spent", () => {
    const { spentGold: _spent, ...old } = champion("b-mid", "blue", "Zed");
    renderScreen(runtime({ champions: [old] }));
    expect(screen.getByTestId("row-gold")).toHaveTextContent("900");
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

describe("the side of an event on LolResultScreen", () => {
  const champions = [
    { id: "b-mid", team: "blue" },
    { id: "r-mid", team: "red" },
  ];
  const rowOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;
  const barHeights = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>("div.rounded-sm")].map((bar) => bar.style.height);
  const killWith = (data?: Record<string, string>) => ({
    t: 600,
    text: "Zed killed Ahri",
    type: "kill",
    code: "champion_killed",
    ...(data ? { data } : {}),
  });
  const withEvents = (extra: unknown[]) =>
    runtime({
      events: [
        ...Array.from({ length: 8 }, (_, i) => ({ t: 60 * (i + 1), text: "Minion wave spawned", type: "spawn", code: "wave_spawned" })),
        ...extra,
      ],
    });

  it("takes the side of a kill from the team of the champion in its data", () => {
    renderScreen(withEvents([killWith({ actor: "Zed", actorId: "b-mid", target: "Ahri" })]));
    expect(within(rowOf("Zed eliminó a Ahri")).getByText(i18n.t("match.home"))).toBeInTheDocument();
  });

  it("takes the side from the team in the data before looking at the actor", () => {
    expect(sideFromEvent({ data: { team: "red", actorId: "b-mid" } }, champions)).toBe("Away");
    expect(sideFromEvent({ data: { actorId: "r-mid" } }, champions)).toBe("Away");
  });

  it("counts a kill with data in the momentum series", () => {
    const withData = renderScreen(withEvents([killWith({ actor: "Zed", actorId: "b-mid", target: "Ahri" })]));
    const counted = barHeights(withData.container);
    withData.unmount();
    const without = renderScreen(withEvents([killWith()]));
    expect(barHeights(without.container)).not.toEqual(counted);
  });

  it("still reads the side of an old event from its English text", () => {
    expect(sideFromEvent({ text: "RED secured baron" }, champions)).toBe("Away");
    expect(sideFromEvent({ text: "BLUE destroyed red-nexus", data: null }, champions)).toBe("Home");
  });

  it("shows a dash for an event with neither data nor a side in its text", () => {
    expect(sideFromEvent({ text: "Zed killed Ahri" }, champions)).toBe("-");
    renderScreen(withEvents([killWith()]));
    expect(within(rowOf("Zed killed Ahri")).getAllByText("-").length).toBeGreaterThan(0);
  });
});
