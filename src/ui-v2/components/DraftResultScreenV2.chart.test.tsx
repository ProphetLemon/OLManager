import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DraftResultScreenV2 from "@/ui-v2/components/DraftResultScreenV2";
import type { DraftMatchResult } from "@/ui-v2/_legacy/components/match/draftResultSimulator";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "es" } }),
}));
vi.mock("@/lib/teams/teamLogos", () => ({ resolveTeamLogo: () => null }));
vi.mock("@/lib/players/playerPhotos", () => ({ resolvePlayerPhoto: () => null }));

const defaultCss = readFileSync("src/themes/default.css", "utf8");

const mvp = {
  side: "blue" as const,
  playerId: "b-mid",
  playerName: "Blue Mid",
  role: "MID" as const,
  championId: null,
  kills: 1,
  deaths: 0,
  assists: 0,
  gold: 100,
  rating: 7,
};

const value: DraftMatchResult = {
  winnerSide: "blue",
  durationMinutes: 30,
  blueKills: 5,
  redKills: 2,
  mvp,
  playerResults: [],
  goldDiffTimeline: [
    { minute: 0, diff: 0 },
    { minute: 10, diff: 2400 },
    { minute: 20, diff: -1200 },
    { minute: 30, diff: 5200 },
  ],
  timelineEvents: [],
  objectives: {
    blue: { voidgrubs: 0, dragons: 0, dragonSoul: false, elderDragons: 0, heralds: 0, barons: 0, towers: 0, inhibitors: 0 },
    red: { voidgrubs: 0, dragons: 0, dragonSoul: false, elderDragons: 0, heralds: 0, barons: 0, towers: 0, inhibitors: 0 },
  },
  power: { blue: 60, red: 50, diff: 10, autoWin: false, winProbBlue: 55 },
};

const snapshot = {
  home_team: { id: "team-1", name: "Alpha FC", players: [] },
  away_team: { id: "team-2", name: "Beta FC", players: [] },
} as unknown as MatchSnapshot;

function renderChart() {
  return render(
    <DraftResultScreenV2
      snapshot={snapshot}
      controlledSide="blue"
      result={value}
      seriesGames={[{ gameIndex: 1, result: value, winnerSide: "blue" }]}
      seriesLength={1}
      seriesGameIndex={1}
      userSeriesWins={1}
      opponentSeriesWins={0}
      onContinue={vi.fn()}
    />,
  );
}

describe("gold advantage chart axis labels", () => {
  it("draws the axis values as HTML next to the SVG, not as SVG text that shrinks with the viewBox", () => {
    const { container } = renderChart();
    const svg = container.querySelector("svg[role='img']");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("text")).toHaveLength(0);

    const axis = screen.getByTestId("gold-axis");
    expect(svg!.contains(axis)).toBe(false);
    expect(axis.querySelectorAll("span")).toHaveLength(3);
  });

  it("writes the axis values in the game's number format, like the gold in the rows", () => {
    renderChart();
    const axis = screen.getByTestId("gold-axis");
    expect(Array.from(axis.querySelectorAll("span")).map((node) => node.textContent)).toEqual(["+5,2k", "0", "-5,2k"]);
  });

  it("sizes the labels with the 0.75rem token and colors them with a token, no raw color", () => {
    renderChart();
    const axis = screen.getByTestId("gold-axis");
    expect(axis.className).toContain("text-2xs");
    expect(axis.className).toContain("text-muted-foreground");
    for (const label of Array.from(axis.querySelectorAll("span"))) {
      expect(label.getAttribute("style") ?? "").not.toMatch(/rgba?\(|#[0-9a-f]{3,8}|font-size/i);
    }
    // text-2xs resolves to --text-2xs; at the 16 px root that is 12 px, whatever the SVG scale is.
    const token = /--text-2xs:\s*([\d.]+)rem/.exec(defaultCss);
    expect(token).not.toBeNull();
    expect(Number(token![1]) * 16).toBeGreaterThanOrEqual(12);
  });

  it("puts each label on the line it names: the top line, the zero line and the bottom line of the chart", () => {
    renderChart();
    const tops = Array.from(screen.getByTestId("gold-axis").querySelectorAll("span")).map((node) =>
      Number.parseFloat((node as HTMLElement).style.top),
    );
    // Lines are at y = 8, 36 and 64 of a 72-high viewBox.
    expect(tops[0]).toBeCloseTo((8 / 72) * 100, 5);
    expect(tops[1]).toBeCloseTo(50, 5);
    expect(tops[2]).toBeCloseTo((64 / 72) * 100, 5);
  });
});
