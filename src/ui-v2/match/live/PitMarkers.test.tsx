import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { MAP_UNITS, PITS, anchorTransform } from "@/lib/match/live/mapGeometry";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { ArenaHarness } from "./arenaHarness.testing";
import { createTestBus, makeChampion, makeState } from "./arenaFixtures.testing";
import { PitMarkers } from "./PitMarkers";

const SIZE = 540;
const NOW = 600;

type Timer = { alive: boolean; hp?: number; maxHp?: number; nextSpawnAt?: number | null; unlocked?: boolean };

/** A state whose neutral timers and objectives are the ones given; the engine sends more than the types list. */
function stateWith(
  entities: Record<string, Timer> = {},
  extras: Record<string, unknown> = {},
  neutral: Record<string, unknown> = {},
  objectives: Record<string, unknown> = {},
): LolSimV1RuntimeState {
  const base = makeState({ timeSec: NOW, champions: [makeChampion("ruvia", "blue", 0.3, 0.3, { name: "Ruvia" })] });
  return {
    ...base,
    neutralTimers: { dragonSoulUnlocked: false, elderUnlocked: false, entities, ...neutral },
    objectives: { ...base.objectives, dragon: { ...base.objectives.dragon, ...objectives } },
    ...extras,
  } as unknown as LolSimV1RuntimeState;
}

function renderPits(state: LolSimV1RuntimeState) {
  return render(
    <ArenaHarness bus={createTestBus().bus} sizePx={SIZE}>
      <PitMarkers state={state} />
    </ArenaHarness>,
  );
}

const dragonPit = () => screen.getByTestId("pit-dragon");
const topPit = () => screen.getByTestId("pit-top");

describe("a pit with something up", () => {
  it("says Up and the health percent, with a bar", () => {
    renderPits(stateWith({ dragon: { alive: true, hp: 620, maxHp: 1000 } }, {}, { dragonCurrentKind: "infernal" }));
    expect(dragonPit()).toHaveAttribute("data-status", "alive");
    expect(within(dragonPit()).getByText("Up 62%")).toBeInTheDocument();
    expect(within(dragonPit()).getByTestId("pit-hp").firstElementChild).toHaveStyle({ width: "62%" });
  });

  it("says Up alone when the engine sends no health", () => {
    renderPits(stateWith({ baron: { alive: true } }));
    expect(within(topPit()).getByText("Up")).toBeInTheDocument();
    expect(within(topPit()).queryByTestId("pit-hp")).toBeNull();
  });
});

describe("a pit with nothing up", () => {
  it("counts down to the next spawn in minutes and seconds, with no health bar", () => {
    renderPits(stateWith({ dragon: { alive: false, nextSpawnAt: NOW + 201 } }));
    expect(dragonPit()).toHaveAttribute("data-status", "countdown");
    expect(within(dragonPit()).getByText("3:21")).toBeInTheDocument();
    expect(within(dragonPit()).queryByTestId("pit-hp")).toBeNull();
    expect(within(dragonPit()).queryByText(/^Up/)).toBeNull();
  });

  it("shows the name alone when no spawn is planned", () => {
    // The engine stores a huge sentinel when nothing is left to spawn.
    renderPits(stateWith({ dragon: { alive: false, nextSpawnAt: null } }, {}, {}, { nextSpawnAt: 9_000_000 }));
    expect(dragonPit()).toHaveAttribute("data-status", "none");
    expect(dragonPit().querySelector(".arena-pit-value")).toBeNull();
  });
});

describe("which monster a pit shows", () => {
  it("names the dragon by its kind", () => {
    renderPits(stateWith({ dragon: { alive: true, hp: 1, maxHp: 1 } }, {}, { dragonCurrentKind: "ocean" }));
    expect(within(dragonPit()).getByText("Ocean Dragon")).toBeInTheDocument();
    expect(dragonPit().querySelector("img")).toHaveAttribute("src", "/lol-map-icons/dragon_ocean.webp");
  });

  it("calls a dragon of unknown kind just Dragon", () => {
    renderPits(stateWith({ dragon: { alive: true } }));
    expect(within(dragonPit()).getByText("Dragon")).toBeInTheDocument();
  });

  it("puts Elder in the dragon pit once it is unlocked", () => {
    renderPits(
      stateWith({ dragon: { alive: false }, elder: { alive: true, hp: 250, maxHp: 1000, unlocked: true } }, {}, { elderUnlocked: true }),
    );
    expect(dragonPit()).toHaveAttribute("data-entity", "elder");
    expect(within(dragonPit()).getByText("Elder Dragon")).toBeInTheDocument();
    expect(within(dragonPit()).getByText("Up 25%")).toBeInTheDocument();
    expect(within(dragonPit()).queryByText("Dragon")).toBeNull();
    expect(dragonPit().querySelector("img")).toHaveAttribute("src", "/lol-map-icons/dragon_elder.webp");
  });

  it("shows the voidgrubs, then the herald, then Baron in the top pit", () => {
    const grubs = renderPits(stateWith({ voidgrubs: { alive: true, hp: 1, maxHp: 1 }, baron: { alive: false, nextSpawnAt: NOW + 900 } }));
    expect(within(topPit()).getByText("Voidgrubs")).toBeInTheDocument();
    grubs.unmount();
    const herald = renderPits(stateWith({ herald: { alive: true, hp: 1, maxHp: 1 } }));
    expect(within(topPit()).getByText("Herald")).toBeInTheDocument();
    herald.unmount();
    renderPits(stateWith({ baron: { alive: true, hp: 1, maxHp: 1 } }));
    expect(within(topPit()).getByText("Baron")).toBeInTheDocument();
  });
});

describe("the soul line", () => {
  it("says which team holds the soul", () => {
    renderPits(stateWith({ dragon: { alive: false, nextSpawnAt: NOW + 60 } }, {}, {}, { soulClaimedBy: "Away" }));
    expect(within(dragonPit()).getByTestId("pit-soul")).toHaveTextContent("Soul: Red");
  });

  it("says the soul is up for grabs when a team is one dragon away", () => {
    renderPits(stateWith({ dragon: { alive: true } }, {}, {}, { homeStacks: 3 }));
    expect(within(dragonPit()).getByTestId("pit-soul")).toHaveTextContent("Soul up for grabs");
  });

  it("says nothing of the soul early on, nor in the top pit", () => {
    renderPits(stateWith({ dragon: { alive: true } }));
    expect(screen.queryByTestId("pit-soul")).toBeNull();
  });
});

describe("the herald carrier line", () => {
  it("names the champion who carries the Herald", () => {
    renderPits(stateWith({ baron: { alive: false, nextSpawnAt: NOW + 400 } }, { heraldTeam: "blue", heraldCarrierId: "ruvia" }));
    expect(within(topPit()).getByTestId("pit-carrier")).toHaveTextContent("Ruvia carries the Herald");
  });

  it("names the team when the carrier is not known", () => {
    renderPits(stateWith({ baron: { alive: false, nextSpawnAt: NOW + 400 } }, { heraldTeam: "red" }));
    expect(within(topPit()).getByTestId("pit-carrier")).toHaveTextContent("Red carries the Herald");
  });

  it("is absent when nobody carries it", () => {
    renderPits(stateWith({ herald: { alive: true } }));
    expect(screen.queryByTestId("pit-carrier")).toBeNull();
  });
});

describe("placement and access", () => {
  it("places each pit at its place on the map with a transform", () => {
    renderPits(stateWith({ dragon: { alive: true }, baron: { alive: true } }));
    const at = (pit: { x: number; y: number }) => anchorTransform({ x: pit.x / MAP_UNITS, y: pit.y / MAP_UNITS }, SIZE);
    expect(dragonPit().style.transform).toBe(at(PITS.dragon));
    expect(topPit().style.transform).toBe(at(PITS.top));
    expect(dragonPit().style.left).toBe("");
  });

  it("is hidden from assistive technology: the Fight board is the text twin", () => {
    renderPits(stateWith({ dragon: { alive: true } }));
    expect(screen.getByTestId("pit-markers")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("PitMarkers in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the dragon, the soul and the carrier in Spanish", () => {
    renderPits(
      stateWith({ dragon: { alive: true, hp: 500, maxHp: 1000 } }, { heraldTeam: "blue" }, { dragonCurrentKind: "mountain" }, { soulClaimedBy: "Home" }),
    );
    expect(within(dragonPit()).getByText("Dragón de montaña")).toBeInTheDocument();
    expect(within(dragonPit()).getByText("Vivo 50%")).toBeInTheDocument();
    expect(within(dragonPit()).getByTestId("pit-soul")).toHaveTextContent("Alma: Azul");
    expect(within(topPit()).getByTestId("pit-carrier")).toHaveTextContent("Azul lleva al Heraldo");
  });
});
