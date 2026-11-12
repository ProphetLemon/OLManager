import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import ChampionDraft, {
  type ChampionDraftResultPayload,
} from "@/ui-v2/_legacy/components/match/ChampionDraft";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { GameStateData } from "@/store/gameStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const ROLES = ["Top", "Jungle", "Mid", "Adc", "Support"];

interface Signature {
  blue: string[];
  red: string[];
}

function team(id: string) {
  return {
    id,
    name: `Team ${id}`,
    draft_strategy: "Balanced",
    players: ROLES.map((role, index) => ({
      id: `${id}-p${index}`,
      name: `${id} ${role}`,
      role,
      position: role,
      condition: 100,
      traits: [],
    })),
  };
}

function gameStateFor(
  blueId: string,
  redId: string,
  signature: Signature,
): GameStateData {
  const entries = (teamId: string, champions: string[]) =>
    champions.map((championId, index) => ({
      player_id: `${teamId}-p${index}`,
      champion_id: championId,
      mastery: 95,
      last_active_on: "2026-01-01",
    }));
  return {
    champion_masteries: [
      ...entries(blueId, signature.blue),
      ...entries(redId, signature.red),
    ],
    players: [],
    staff: [],
    teams: [],
    leagues: [],
  } as unknown as GameStateData;
}

async function skippedDraft(
  blueId: string,
  redId: string,
  signature: Signature,
): Promise<ChampionDraftResultPayload> {
  const onComplete = vi.fn();
  const snapshot = { home_team: team(blueId), away_team: team(redId) } as unknown as MatchSnapshot;
  render(
    <ChampionDraft
      snapshot={snapshot}
      onComplete={onComplete}
      controlledSide="blue"
      gameState={gameStateFor(blueId, redId, signature)}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByText("match.draft.skipDraft"));
  fireEvent.click(screen.getByText("match.draft.finalizeDraft"));
  expect(onComplete).toHaveBeenCalledTimes(1);
  const payload = onComplete.mock.calls[0][0] as ChampionDraftResultPayload;
  cleanup();
  return payload;
}


async function unattendedDraft(
  blueId: string,
  redId: string,
  signature: Signature,
): Promise<ChampionDraftResultPayload> {
  const onComplete = vi.fn();
  const snapshot = { home_team: team(blueId), away_team: team(redId) } as unknown as MatchSnapshot;
  render(
    <ChampionDraft
      snapshot={snapshot}
      onComplete={onComplete}
      allAi
      autoFinalize
      gameState={gameStateFor(blueId, redId, signature)}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  for (let i = 0; i < 60 && onComplete.mock.calls.length === 0; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
  }
  expect(onComplete).toHaveBeenCalledTimes(1);
  const payload = onComplete.mock.calls[0][0] as ChampionDraftResultPayload;
  cleanup();
  return payload;
}

const picksOf = (payload: ChampionDraftResultPayload, side: "blue" | "red"): string[] =>
  payload[side].picks.map((pick) => pick.championId);

describe("ChampionDraft skip draft depends on the teams that play", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }));
    window.matchMedia = globalThis.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const first: Signature = {
    blue: ["Camille", "Amumu", "Ahri", "Jinx", "Alistar"],
    red: ["Darius", "Briar", "Azir", "Caitlyn", "Bard"],
  };
  const second: Signature = {
    blue: ["Fiora", "Elise", "Hwei", "Ashe", "Braum"],
    red: ["Gwen", "Kayn", "Katarina", "Ezreal", "Lulu"],
  };

  it("gives two different matchups different picks", async () => {
    const one = await skippedDraft("alpha", "bravo", first);
    const two = await skippedDraft("charlie", "delta", second);

    expect(picksOf(one, "blue").slice().sort()).not.toEqual(picksOf(two, "blue").slice().sort());
    expect(picksOf(one, "red").slice().sort()).not.toEqual(picksOf(two, "red").slice().sort());
  });

  it("makes each side pick the champions its own players master", async () => {
    const one = await skippedDraft("alpha", "bravo", first);

    const bluePicks = new Set(picksOf(one, "blue"));
    const redPicks = new Set(picksOf(one, "red"));
    const blueHits = first.blue.filter((id) => bluePicks.has(id)).length;
    // The opponent bans some of them, so not all five can be picked.
    const redHits = first.red.filter((id) => redPicks.has(id)).length;
    expect(blueHits).toBeGreaterThanOrEqual(2);
    expect(redHits).toBeGreaterThanOrEqual(2);
  });

  it("bans the champions the opponent's players master", async () => {
    const one = await skippedDraft("alpha", "bravo", first);

    const blueBans = new Set(one.blue.bans);
    const redBans = new Set(one.red.bans);
    // Blue bans against red's players, red bans against blue's players.
    const redSignatureBanned = first.red.filter((id) => blueBans.has(id)).length;
    const blueSignatureBanned = first.blue.filter((id) => redBans.has(id)).length;
    expect(redSignatureBanned + blueSignatureBanned).toBeGreaterThanOrEqual(1);
  });

  it("lets the AI of a manual draft pick what its own players master", async () => {
    const one = await unattendedDraft("alpha", "bravo", first);

    const bluePicks = new Set(picksOf(one, "blue"));
    const redPicks = new Set(picksOf(one, "red"));
    // The opponent bans some of them, so not all five can be picked.
    expect(first.blue.filter((id) => bluePicks.has(id)).length).toBeGreaterThanOrEqual(2);
    expect(first.red.filter((id) => redPicks.has(id)).length).toBeGreaterThanOrEqual(2);
  });

  it("gives two different matchups different AI picks in a manual draft", async () => {
    const one = await unattendedDraft("alpha", "bravo", first);
    const two = await unattendedDraft("charlie", "delta", second);

    expect(picksOf(one, "blue").slice().sort()).not.toEqual(picksOf(two, "blue").slice().sort());
    expect(picksOf(one, "red").slice().sort()).not.toEqual(picksOf(two, "red").slice().sort());
  });
});
