import { render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { detectContacts } from "@/lib/match/live/contacts";
import { MAP_UNITS } from "@/lib/match/live/mapGeometry";
import { pitViews } from "@/lib/match/live/objectivesView";

import { ArenaHarness } from "./arenaHarness.testing";
import { createTestBus, makeChampion, makeFrame, makeState, makeStructure } from "./arenaFixtures.testing";
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

describe("ChampionLayer next to an objective pit", () => {
  it("keeps the tag of a champion off the label of the pit", () => {
    const [pit] = pitViews(makeState());
    const at = { x: pit.pos.x / MAP_UNITS, y: pit.pos.y / MAP_UNITS };
    // Standing on the pit, where a tag below the bubble would sit on the label.
    const state = makeState({ champions: [makeChampion("solo", "blue", at.x, at.y, { name: "KORVAN" })] });
    renderLayer(state);
    expect(screen.getByTestId("tag")).not.toHaveAttribute("data-slot", "below");
  });

  it("puts the same champion's tag below, where no pit is", () => {
    renderLayer(makeState({ champions: [makeChampion("solo", "blue", 0.6, 0.2, { name: "KORVAN" })] }));
    expect(screen.getByTestId("tag")).toHaveAttribute("data-slot", "below");
  });
});

/**
 * jsdom lays nothing out, so the width the page gives a tag is stubbed: every probe is `probeWidth`
 * wide and 18 high, and nothing else has a box.
 */
describe("ChampionLayer measures the tags it places", () => {
  let probeWidth = 80;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeAll(() => {
    const isProbe = (element: HTMLElement) => element.classList.contains("arena-tag-probe");
    spies.push(
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
        return isProbe(this) ? probeWidth : 0;
      }),
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
        return isProbe(this) ? 18 : 0;
      }),
    );
  });
  afterAll(() => spies.forEach((spy) => spy.mockRestore()));
  afterEach(() => {
    probeWidth = 80;
  });

  /** Two champions with two-letter names, 54 px apart on the 540 px test map: 27 px tags fit side by side, 80 px tags do not. */
  const pair = (nowSec = 100) =>
    makeState({
      timeSec: nowSec,
      champions: [makeChampion("a", "blue", 0.45, 0.5, { name: "AB" }), makeChampion("b", "red", 0.55, 0.5, { name: "CD" })],
    });

  const slots = () => ["a", "b"].map((id) => within(screen.getByTestId(`champion-${id}`)).getByTestId("tag").getAttribute("data-slot"));

  it("gives a probe of each form to every champion, and the probes add no text to the page", () => {
    renderLayer(pair());
    const probes = document.querySelectorAll<HTMLElement>(".arena-tag-probe");
    expect(probes).toHaveLength(4);
    expect([...probes].map((probe) => `${probe.dataset.probe}:${probe.dataset.form}`).sort()).toEqual([
      "a:compact",
      "a:full",
      "b:compact",
      "b:full",
    ]);
    const holder = document.querySelector(".arena-tag-probes");
    expect(holder).toHaveAttribute("aria-hidden", "true");
    expect(holder?.textContent).toBe("");
    for (const found of screen.getAllByText("AB")) expect(found.closest(".arena-tag-probes")).toBeNull();
  });

  it("solves with the size the page gave the tags: wide tags cannot share the row below two close bubbles", () => {
    renderLayer(pair());
    const [first, second] = slots();
    expect(first).toBe("below");
    expect(second).not.toBe("below");
  });

  it("keeps both below when the tags are as narrow as their letters say", () => {
    probeWidth = 27;
    renderLayer(pair());
    expect(slots()).toEqual(["below", "below"]);
  });

  it("solves again when a commit changes the size of a tag, before anything is painted", () => {
    probeWidth = 27;
    const first = renderLayer(pair());
    expect(slots()).toEqual(["below", "below"]);
    probeWidth = 80;
    const next = pair(100.25);
    first.rerender(
      <ArenaHarness bus={createTestBus().bus}>
        <ChampionLayer
          state={next}
          championByPlayerId={{}}
          contacts={detectContacts(next.champions, next.timeSec)}
          selectedId={null}
          onSelect={() => {}}
        />
      </ArenaHarness>,
    );
    expect(slots()[1]).not.toBe("below");
  });
});

describe("ChampionLayer next to a firing tower", () => {
  /** A tower in the middle of the map shooting the champion just above it. */
  const standoff = () =>
    makeState({
      champions: [makeChampion("solo", "blue", 0.5, 0.5 - 24 / 540, { name: "ROOSTER" })],
      structures: [makeStructure("tower-red", "red", "tower", 0.5, 0.5)],
    });
  const beam = { structureId: "tower-red", targetId: "solo", shots: 2, ageSec: 0.4 };

  function mount(beams: Array<typeof beam>) {
    const state = standoff();
    const { bus } = createTestBus();
    return render(
      <ArenaHarness bus={bus}>
        <ChampionLayer
          state={state}
          championByPlayerId={{}}
          contacts={detectContacts(state.champions, state.timeSec)}
          selectedId={null}
          onSelect={() => {}}
          beams={beams}
        />
      </ArenaHarness>,
    );
  }

  it("puts the tag below the champion when no tower is shooting", () => {
    mount([]);
    expect(screen.getByTestId("tag")).toHaveAttribute("data-slot", "below");
  });

  it("keeps the tag off the ring and the beam of the tower that is shooting", () => {
    mount([beam]);
    expect(screen.getByTestId("tag")).not.toHaveAttribute("data-slot", "below");
  });
});

/**
 * The markers are moved by the frame bus between commits, so at the moment of a solve the marker
 * is drawn somewhere the engine's last answer is not, and it keeps moving until the next solve.
 * The solve has to use the first and plan for the second.
 */
describe("ChampionLayer next to champions on the move", () => {
  const tagOf = (id: string) => within(screen.getByTestId(`champion-${id}`)).queryByTestId("tag");

  function mount(first: ReturnType<typeof makeState>) {
    const test = createTestBus();
    const draw = (state: ReturnType<typeof makeState>) => (
      <ArenaHarness bus={test.bus}>
        <ChampionLayer
          state={state}
          championByPlayerId={{}}
          contacts={detectContacts(state.champions, state.timeSec)}
          selectedId={null}
          onSelect={() => {}}
        />
      </ArenaHarness>
    );
    const view = render(draw(first));
    return { ...test, view, commit: (state: ReturnType<typeof makeState>) => view.rerender(draw(state)) };
  }

  const pairAt = (timeSec: number, bY: number) =>
    makeState({
      timeSec,
      champions: [makeChampion("a", "blue", 0.5, 0.5, { name: "AB" }), makeChampion("b", "red", 0.5, bY, { name: "CD" })],
    });

  it("puts the tag below a lone champion while nobody is near", () => {
    const { commit, publish } = mount(pairAt(100, 0.8));
    publish(makeFrame(pairAt(100, 0.8)));
    commit(pairAt(100.25, 0.8));
    expect(tagOf("a")).toHaveAttribute("data-slot", "below");
  });

  it("solves for where a marker is drawn, not for where the last answer puts it", () => {
    const { commit, publish } = mount(pairAt(100, 0.8));
    // The answer says B is far off, but the frame still draws it right under A, where the tag would go.
    publish(makeFrame(pairAt(100, 0.55)));
    commit(pairAt(100.25, 0.8));
    expect(tagOf("a")).not.toHaveAttribute("data-slot", "below");
  });

  it("keeps a tag out of the way of a champion whose walk leads through it", () => {
    const { commit, publish } = mount(pairAt(100, 0.85));
    publish(makeFrame(pairAt(100, 0.85)));
    // B was at 0.85 a quarter of a second ago, is at 0.75 now, and keeps walking towards A.
    commit(pairAt(100.25, 0.75));
    expect(tagOf("a")).not.toHaveAttribute("data-slot", "below");
  });

  it("leaves the tag where it is when the other champion stands at the same place the walk ended", () => {
    const { commit, publish } = mount(pairAt(100, 0.75));
    publish(makeFrame(pairAt(100, 0.75)));
    commit(pairAt(100.25, 0.75));
    expect(tagOf("a")).toHaveAttribute("data-slot", "below");
  });
});

describe("ChampionLayer next to a nexus", () => {
  it("keeps the tag of a champion off the name under the nexus", () => {
    const nexus = makeStructure("blue-nexus", "blue", "nexus", 0.1, 0.88);
    // Just above the nexus, where a tag below the bubble would sit on its name.
    renderLayer(makeState({ champions: [makeChampion("solo", "blue", 0.1, 0.8, { name: "KORVAN" })], structures: [nexus] }));
    expect(screen.getByTestId("tag")).not.toHaveAttribute("data-slot", "below");
  });

  it("puts the same champion's tag below when no nexus is there", () => {
    renderLayer(makeState({ champions: [makeChampion("solo", "blue", 0.1, 0.8, { name: "KORVAN" })] }));
    expect(screen.getByTestId("tag")).toHaveAttribute("data-slot", "below");
  });
});
