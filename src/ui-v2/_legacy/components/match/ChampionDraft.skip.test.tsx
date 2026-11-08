import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import ChampionDraft, {
  type ChampionDraftResultPayload,
} from "@/ui-v2/_legacy/components/match/ChampionDraft";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const ROLES = ["Top", "Jungle", "Mid", "Adc", "Support"];

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

function snapshot(): MatchSnapshot {
  return { home_team: team("blue"), away_team: team("red") } as unknown as MatchSnapshot;
}

describe("ChampionDraft skip and instant resolution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
      }),
    );
    window.matchMedia = globalThis.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("lets the user skip the draft and finishes it with staff picks and bans", async () => {
    const onComplete = vi.fn();
    render(<ChampionDraft snapshot={snapshot()} onComplete={onComplete} controlledSide="blue" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("match.draft.finalizeDraft")).toBeNull();
    fireEvent.click(screen.getByText("match.draft.skipDraft"));
    fireEvent.click(screen.getByText("match.draft.finalizeDraft"));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0] as ChampionDraftResultPayload;
    expect(payload.blue.picks).toHaveLength(5);
    expect(payload.red.picks).toHaveLength(5);
    expect(payload.blue.bans).toHaveLength(5);
    expect(payload.red.bans).toHaveLength(5);
    const all = [
      ...payload.blue.picks.map((p) => p.championId),
      ...payload.red.picks.map((p) => p.championId),
      ...payload.blue.bans,
      ...payload.red.bans,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("resolves an instant draft with no timers and completes it on its own", async () => {
    const onComplete = vi.fn();
    render(<ChampionDraft snapshot={snapshot()} onComplete={onComplete} allAi instant autoFinalize />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0] as ChampionDraftResultPayload;
    expect(payload.blue.picks).toHaveLength(5);
    expect(payload.red.picks).toHaveLength(5);
  });

  it("still plays an unattended draft step by step when it is not instant", async () => {
    const onComplete = vi.fn();
    render(<ChampionDraft snapshot={snapshot()} onComplete={onComplete} allAi />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByText("match.draft.finalizeDraft")).toBeNull();
  });
});
