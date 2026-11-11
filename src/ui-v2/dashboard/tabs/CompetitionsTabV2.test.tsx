import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { GameStateData } from "@/store/gameStore";
import { CompetitionsTabV2 } from "./CompetitionsTabV2";

function buildState(position: string): GameStateData {
  return {
    leagues: [
      {
        id: "lec-league",
        competition_id: "lec",
        name: "LEC",
        tier: 1,
        active: true,
        season: 1,
        standings: [],
        fixtures: [],
      },
    ],
    teams: [{ id: "t1", name: "Alpha", short_name: "ALP", competition_id: "lec" }],
    players: [
      {
        id: "p1",
        team_id: "t1",
        match_name: "Zed",
        full_name: "Zed Smith",
        position,
        natural_position: position,
        attributes: {},
        lol_role: position,
      },
    ],
  } as unknown as GameStateData;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("CompetitionsTabV2 players table", () => {
  it("shows the translated role label instead of the raw position", () => {
    render(<CompetitionsTabV2 gameState={buildState("JUNGLE")} />);

    fireEvent.click(screen.getByRole("button", { name: /LEC/ }));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("competitions.viewPlayers", { count: 1 }) }));

    expect(screen.getByText("Jungle")).toBeTruthy();
    expect(screen.queryByText("JUNGLE")).toBeNull();
  });
});

describe("CompetitionsTabV2 initial selection", () => {
  it("opens the given competition with its standings view", () => {
    render(<CompetitionsTabV2 gameState={buildState("MID")} initialCompetitionId="lec" />);

    expect(screen.queryByText(i18n.t("competitions.selectPrompt"))).toBeNull();
    expect(screen.getAllByText("LEC").length).toBeGreaterThan(1);
  });
});
