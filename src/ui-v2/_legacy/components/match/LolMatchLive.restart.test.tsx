import { useState } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LolMatchLive from "@/ui-v2/_legacy/components/match/LolMatchLive";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/assets/map", () => ({
  getWalls: () => [],
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/engine/navigation", () => ({
  NavGrid: class {},
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation", () => ({
  PrototypeSimulation: class {
    state = { winner: "blue", timeSec: 1500, events: [], champions: [], stats: undefined };
    constructor() {
      constructed.count += 1;
    }
    setRunning() {}
    tick() {}
  },
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/backend/tauri-client", () => ({
  LolSimV2Client: class {
    init() {
      return new Promise(() => undefined);
    }
    dispose() {
      return Promise.resolve();
    }
  },
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/ui/render", () => ({
  renderSimulation: vi.fn(),
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/ui/panels", () => ({
  LecLowerThirdPanel: () => null,
}));

const team = (id: string) => ({ id, name: id, players: [] });
const baseSnapshot = {
  phase: "Live",
  current_minute: 0,
  home_score: 0,
  away_score: 0,
  home_team: team("home"),
  away_team: team("away"),
  events: [],
} as unknown as MatchSnapshot;

describe("LolMatchLive", () => {
  beforeEach(() => {
    constructed.count = 0;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  it("builds the simulation once when champion profiles load late", async () => {
    let releaseChampionJson: (value: unknown) => void = () => undefined;
    const championJson = new Promise((resolve) => {
      releaseChampionJson = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/champion.json")) {
        return championJson.then(() => ({
          ok: true,
          json: async () => ({ data: { Ahri: { id: "Ahri", tags: ["Mage"], stats: { hp: 590, attackrange: 550 } } } }),
        }));
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LolMatchLive
        gameState={null}
        snapshot={baseSnapshot}
        championSelections={{ home: { p1: "Ahri" }, away: {} } as never}
        onSnapshotUpdate={() => undefined}
        onImportantEvent={() => undefined}
        onFullTime={() => undefined}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseChampionJson(undefined);
    await waitFor(() => expect(constructed.count).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).toHaveBeenCalled();
    expect(constructed.count).toBe(1);
    vi.unstubAllGlobals();
  });

  it("does not restart the simulation when the finished snapshot is fed back as a prop", async () => {
    const onFullTime = vi.fn();

    function Parent() {
      const [snapshot, setSnapshot] = useState(baseSnapshot);
      return (
        <LolMatchLive
          gameState={null}
          snapshot={snapshot}
          onSnapshotUpdate={setSnapshot}
          onImportantEvent={() => undefined}
          onFullTime={onFullTime}
        />
      );
    }

    render(<Parent />);

    await waitFor(() => expect(onFullTime).toHaveBeenCalled(), { timeout: 2000 });
    const afterFinish = constructed.count;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(constructed.count).toBe(afterFinish);
  });
});
