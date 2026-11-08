import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import PreMatchSetup from "@/ui-v2/_legacy/components/match/PreMatchSetup";
import type { EnginePlayerData, MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { GameStateData } from "@/store/gameStore";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, arg?: Record<string, unknown>) =>
      arg && "max" in arg ? `${key}:${String(arg.count)}/${String(arg.max)}` : key,
  }),
}));

vi.mock("@/ui-v2/_legacy/components/match/opponentIntelService", () => ({
  buildOpponentIntel: () => ({}),
}));
vi.mock("@/ui-v2/_legacy/components/match/OpponentIntelCard", () => ({
  default: () => null,
}));

const player = (id: string, role: string, isImport = false): EnginePlayerData => ({
  id,
  name: id,
  role,
  condition: 100,
  fitness: 75,
  mechanics: 70,
  laning: 70,
  teamfighting: 70,
  macro_play: 70,
  consistency: 70,
  shotcalling: 50,
  champion_pool: 70,
  discipline: 70,
  mental_resilience: 70,
  traits: [],
  is_import: isImport,
});

const snapshot = {
  phase: "PreGame",
  home_team: {
    id: "home",
    name: "Home Team",
    draft_strategy: "Balanced",
    players: [
      player("top", "Top", true),
      player("jg", "Jungle", true),
      player("mid", "Mid"),
      player("adc", "Adc"),
      player("sup", "Support"),
    ],
  },
  away_team: { id: "away", name: "Away Team", draft_strategy: "Balanced", players: [] },
  home_bench: [player("mid-import", "Mid", true), player("mid-res", "Mid")],
  away_bench: [],
} as unknown as MatchSnapshot;

const gameState = { teams: [], players: [], clock: { current_date: "2026-01-01" } } as unknown as GameStateData;

function renderSetup(onUpdateSnapshot = vi.fn()) {
  render(
    <PreMatchSetup
      snapshot={snapshot}
      gameState={gameState}
      userSide="Home"
      onStart={vi.fn()}
      onCancel={vi.fn()}
      onUpdateSnapshot={onUpdateSnapshot}
    />,
  );
}

describe("PreMatchSetup import rule", () => {
  beforeEach(() => invokeMock.mockReset());

  it("flags imports with a badge and shows the import count", () => {
    renderSetup();
    expect(screen.getAllByTestId("import-badge").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("import-count")).toHaveTextContent("squad.importsInLineup:2/2");
  });

  it("refuses a swap that would start a third import without calling the backend", () => {
    renderSetup();
    fireEvent.click(screen.getAllByText("mid")[0]);
    fireEvent.click(screen.getByText("mid-import"));

    expect(screen.getByTestId("import-notice")).toHaveTextContent("squad.tooManyImports:3/2");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("still swaps in a resident", async () => {
    invokeMock.mockResolvedValue(snapshot);
    const onUpdateSnapshot = vi.fn();
    renderSetup(onUpdateSnapshot);
    fireEvent.click(screen.getAllByText("mid")[0]);
    fireEvent.click(screen.getByText("mid-res"));

    await waitFor(() => expect(onUpdateSnapshot).toHaveBeenCalled());
    expect(screen.queryByTestId("import-notice")).toBeNull();
  });

  it("shows the backend refusal when the check is bypassed", async () => {
    invokeMock.mockRejectedValueOnce("LINEUP_TOO_MANY_IMPORTS:3:2");
    renderSetup();
    fireEvent.click(screen.getAllByText("top")[0]);
    fireEvent.click(screen.getByText("mid-res"));

    await waitFor(() =>
      expect(screen.getByTestId("import-notice")).toHaveTextContent("squad.tooManyImports:3/2"),
    );
  });
});
