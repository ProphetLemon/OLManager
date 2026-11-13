import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { detectContacts } from "@/lib/match/live/contacts";

import { ArenaHarness } from "./arenaHarness.testing";
import { createTestBus, makeChampion, makeState } from "./arenaFixtures.testing";
import { ChampionLayer } from "./ChampionLayer";

/** Ten champions piled on one spot, nine of them with a state: there are not enough free slots for every tag. */
function denseFight() {
  const at = (index: number) => 0.5 + (index % 5) * 0.004;
  const champions = [
    ...["a1", "a2", "a3", "a4", "a5"].map((id, i) => makeChampion(id, "blue", at(i), 0.5, { state: "objective" })),
    ...["b1", "b2", "b3", "b4", "b5"].map((id, i) => makeChampion(id, "red", at(i), 0.505, { state: "objective" })),
  ];
  champions[2] = { ...champions[2], name: "BRANNIC", state: "recall", recallChannelUntil: 103.9 };
  champions[3] = { ...champions[3], alive: false, respawnAt: 112 };
  champions[0] = { ...champions[0], lastDamagedByChampionId: "b1", lastDamagedByChampionAt: 99 };
  champions[5] = { ...champions[5], lastDamagedByChampionId: "a1", lastDamagedByChampionAt: 99 };
  return makeState({ champions });
}

function renderLayer(state = denseFight(), selectedId: string | null = null) {
  const { bus } = createTestBus();
  const contacts = detectContacts(state.champions, state.timeSec);
  return render(
    <ArenaHarness bus={bus}>
      <ChampionLayer
        state={state}
        championByPlayerId={{ a1: "Ahri" }}
        contacts={contacts}
        selectedId={selectedId}
        onSelect={() => {}}
      />
    </ArenaHarness>,
  );
}

describe("ChampionLayer", () => {
  it("draws one marker per champion", () => {
    renderLayer();
    expect(document.querySelectorAll(".arena-champ")).toHaveLength(10);
  });

  it("never loses a state in a dense fight: every champion with one has a tag or a badge", () => {
    renderLayer();
    const recalling = screen.getByTestId("champion-a3");
    expect(recalling).toHaveAttribute("data-state", "recall");
    expect(recalling.textContent).toContain("R 3.9");

    const withState = [...document.querySelectorAll<HTMLElement>(".arena-champ[data-state]:not([data-dead])")];
    expect(withState).toHaveLength(9);
    for (const marker of withState) {
      const shown = within(marker).queryByTestId("tag") ?? within(marker).queryByTestId("state-badge");
      expect(shown, marker.dataset.testid).not.toBeNull();
    }
  });

  it("falls back to a badge for the champions the tags had no room for", () => {
    renderLayer();
    const badges = document.querySelectorAll("[data-testid='state-badge']");
    const tags = document.querySelectorAll("[data-testid='tag']");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.length + tags.length).toBeGreaterThanOrEqual(9);
  });

  it("counts a dead champion down in the bubble even when the tag has no room", () => {
    renderLayer();
    const dead = screen.getByTestId("champion-a4");
    expect(within(dead).getByTestId("respawn-seconds")).toHaveTextContent("12");
    expect(dead).toHaveAttribute("data-dead", "true");
  });

  it("rings only the champions in a fight", () => {
    renderLayer();
    const ringed = [...document.querySelectorAll(".ring-fighting")].map(
      (bubble) => bubble.closest(".arena-champ")?.getAttribute("data-testid"),
    );
    expect(ringed.sort()).toEqual(["champion-a1", "champion-b1"]);
  });

  it("follows one player and steps the other nine back", () => {
    renderLayer(denseFight(), "a2");
    expect(document.querySelectorAll("[data-selected]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-dim]")).toHaveLength(9);
  });

  it("dims nobody when nobody is followed", () => {
    renderLayer();
    expect(document.querySelectorAll("[data-dim]")).toHaveLength(0);
  });

  it("gives a lone champion on an empty map a full tag with its name", () => {
    const state = makeState({ champions: [makeChampion("solo", "blue", 0.5, 0.5, { name: "Solo" })] });
    renderLayer(state);
    expect(within(screen.getByTestId("champion-solo")).getByTestId("tag")).toHaveAttribute("data-form", "full");
  });

  it("keeps the slot of a tag across commits while it still fits", () => {
    const state = makeState({ champions: [makeChampion("solo", "blue", 0.5, 0.5, { name: "Solo" })] });
    const first = renderLayer(state);
    const slot = within(screen.getByTestId("champion-solo")).getByTestId("tag").getAttribute("data-slot");
    first.rerender(
      <ArenaHarness bus={createTestBus().bus}>
        <ChampionLayer
          state={{ ...state, timeSec: 100.25 }}
          championByPlayerId={{}}
          contacts={detectContacts(state.champions, 100.25)}
          selectedId={null}
          onSelect={() => {}}
        />
      </ArenaHarness>,
    );
    expect(within(screen.getByTestId("champion-solo")).getByTestId("tag")).toHaveAttribute("data-slot", slot);
  });
});

describe("ChampionLayer in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("writes the states in Spanish with a decimal comma and shows no raw key", () => {
    const state = makeState({
      champions: [
        makeChampion("solo", "blue", 0.5, 0.5, { name: "Solo", state: "recall", recallChannelUntil: 103.9 }),
        makeChampion("dead", "red", 0.2, 0.2, { name: "Muerto", alive: false, respawnAt: 111 }),
      ],
    });
    renderLayer(state);
    expect(screen.getByTestId("champion-solo").textContent).toContain("Regreso 3,9s");
    expect(screen.getByTestId("champion-dead").textContent).toContain("Caído 11s");
    expect(document.body.textContent).not.toContain("onAir.match");
  });
});
