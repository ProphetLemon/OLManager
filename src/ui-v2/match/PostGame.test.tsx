import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { finishedMatch, matchRecord } from "@/lib/match/live/postGameFixtures.testing";
import type { GameStateData } from "@/store/gameStore";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import PostGame, { type PostGameProps } from "./PostGame";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const snapshot = {
  home_team: { id: "shi", name: "Shifters", players: [] },
  away_team: { id: "mkoi", name: "Movistar KOI", players: [] },
  current_minute: 31,
} as unknown as MatchSnapshot;

const gameState = {
  teams: [
    { id: "shi", name: "Shifters", short_name: "SHI" },
    { id: "mkoi", name: "Movistar KOI", short_name: "MKOI" },
  ],
} as unknown as GameStateData;

const PICKS = {
  home: { "b-adc": "Jinx", "b-top": "Renekton" },
  away: { "r-adc": "Kaisa" },
  homeRoles: {},
  awayRoles: {},
};

function show(over: Partial<PostGameProps> = {}, state: Record<string, unknown> | null = {}) {
  const onFinish = vi.fn();
  const onPressConference = vi.fn();
  const runtime = state === null ? null : (finishedMatch(state) as unknown as LolSimV1RuntimeState);
  const utils = render(
    <PostGame
      snapshot={snapshot}
      gameState={gameState}
      userSide="Home"
      finalRuntimeState={runtime}
      championSelections={PICKS}
      onFinish={onFinish}
      onPressConference={onPressConference}
      {...over}
    />,
  );
  return { ...utils, onFinish, onPressConference };
}

describe("PostGame: the result bar", () => {
  it("shows both clubs with the result of each, the kills, the length of the match and that it is over", () => {
    show();
    const bar = screen.getByRole("banner");
    expect(within(bar).getByText("SHI")).toBeInTheDocument();
    expect(within(bar).getByText("Victory")).toHaveAttribute("data-result", "win");
    expect(within(bar).getByText("Defeat")).toHaveAttribute("data-result", "loss");
    expect(within(bar).getByRole("img", { name: "Shifters kills 21" })).toHaveTextContent("21");
    expect(within(bar).getByRole("img", { name: "Movistar KOI kills 11" })).toHaveTextContent("11");
    expect(within(bar).getByText("31:48")).toBeInTheDocument();
    expect(within(bar).getByText("Match Over")).toBeInTheDocument();
  });

  it("publishes the two clubs' colours as the side tokens on its root, once", () => {
    show();
    const root = screen.getByTestId("post-game");
    expect(root.style.getPropertyValue("--side-blue")).not.toBe("");
    expect(root.style.getPropertyValue("--side-red-band")).not.toBe("");
  });

  it("names the MVP with the champion and K/D/A", () => {
    show();
    const chip = screen.getByRole("group", { name: "MVP: Paduck" });
    expect(chip).toHaveTextContent("MVP Paduck");
    expect(chip).toHaveTextContent("Jinx, 7/2/8");
  });
});

describe("PostGame: the views", () => {
  it("opens on the scoreboard and switches between the three views with a radio group", () => {
    show();
    const views = screen.getByRole("group", { name: "Post-game view" });
    const radios = within(views).getAllByRole("radio");
    expect(radios.map((radio) => (radio as HTMLInputElement).labels?.[0].textContent)).toEqual(["Scoreboard", "Graphs", "Timeline"]);
    expect(radios[0]).toBeChecked();
    expect(screen.getByTestId("post-game-scoreboard")).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Scoreboard" })).toBeInTheDocument();

    fireEvent.click(within(views).getByRole("radio", { name: "Graphs" }));
    expect(screen.getByTestId("post-game-graphs")).toBeInTheDocument();
    expect(screen.queryByTestId("post-game-scoreboard")).not.toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Graphs" })).toBeInTheDocument();

    fireEvent.click(within(views).getByRole("radio", { name: "Timeline" }));
    expect(screen.getByTestId("post-game-timeline")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(5);
  });

  it("tells a skipped match's timeline and graphs they are partial", () => {
    show({}, { matchRecord: matchRecord({ skippedAtSec: 300 }) });
    fireEvent.click(screen.getByRole("radio", { name: "Timeline" }));
    expect(screen.getByTestId("timeline-partial")).toHaveTextContent("5:00");
  });
});

describe("PostGame: the buttons", () => {
  it("continues and opens the press conference with the handlers it was given", () => {
    const { onFinish, onPressConference } = show();
    fireEvent.click(screen.getByRole("button", { name: "Press Conference" }));
    expect(onPressConference).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("has no press conference button when there is no press conference to open", () => {
    show({ onPressConference: undefined });
    expect(screen.queryByRole("button", { name: "Press Conference" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
});

describe("PostGame: a match with nothing recorded", () => {
  it("shows the clubs and the buttons, says only the result can be shown, and invents no numbers", () => {
    const { onFinish } = show({}, null);
    expect(screen.getByTestId("post-game-empty")).toHaveTextContent("The details of this match were not recorded");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});

describe("PostGame: the scrim preparation note", () => {
  it("keeps the note the old result screen showed when the manager prepared this match", () => {
    show({
      snapshot: {
        ...snapshot,
        lol_scrim_prep: { home: { preparation: 4, comfortByPlayer: { a: 2 } } },
      } as unknown as MatchSnapshot,
    });
    expect(screen.getByTestId("scrim-prep")).toHaveTextContent("+6");
  });

  it("shows no note when there was no preparation", () => {
    show();
    expect(screen.queryByTestId("scrim-prep")).not.toBeInTheDocument();
  });
});

describe("PostGame with a state saved before matches kept a record", () => {
  const oldEvents = [
    { t: 8, text: "Minion wave spawned", type: "spawn", code: "wave_spawned" },
    { t: 600, text: "Paduck killed Supa", type: "kill", code: "champion_killed", data: { actor: "Paduck", actorId: "b-adc", target: "Supa" } },
    { t: 1790, text: "BLUE destroyed red-nexus", type: "nexus", code: "structure_destroyed", data: { team: "blue", structure: "red-nexus" } },
    { t: 1700, text: "BLUE secured baron", type: "baron" },
  ];

  it("lists the key events from the engine's own list and says they may not all be there", () => {
    show({}, { matchRecord: undefined, events: oldEvents });
    fireEvent.click(screen.getByRole("radio", { name: "Timeline" }));
    expect(screen.getByTestId("timeline-partial")).toHaveTextContent("not recorded in full");
    const rows = screen.getAllByRole("listitem");
    // Not first blood: nobody can say it was the first kill of the match.
    expect(within(rows[0]).getByText("Paduck eliminated Supa")).toBeInTheDocument();
    // An event with no code keeps the line it was stored with.
    expect(within(rows[1]).getByText("BLUE secured baron")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Blue destroyed the nexus")).toBeInTheDocument();
    expect(rows).toHaveLength(3);
  });

  it("charts no gold difference, and says why, because none was recorded", () => {
    show({}, { matchRecord: undefined });
    fireEvent.click(screen.getByRole("radio", { name: "Graphs" }));
    expect(screen.getByText("The gold difference of this match was not recorded.")).toBeInTheDocument();
    // The per-player bars still read the engine's own final numbers: ten for damage, ten for gold.
    expect(screen.getAllByRole("img", { name: /of the team$/ })).toHaveLength(20);
  });
});

describe("PostGame in Spanish", () => {
  it("writes the screen in Spanish", async () => {
    await i18n.changeLanguage("es");
    show();
    expect(screen.getAllByText("Victoria").length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: "Gráficos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rueda de Prensa" })).toBeInTheDocument();
    // Compact numbers follow the language's decimal mark.
    expect(screen.getAllByText("34,7k").length).toBeGreaterThan(0);
    await i18n.changeLanguage("en");
  });
});
