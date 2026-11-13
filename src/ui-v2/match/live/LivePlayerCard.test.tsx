import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { ChampionState } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

import { makeChampion } from "./arenaFixtures.testing";
import { LivePlayerCard, type LivePlayerCardProps } from "./LivePlayerCard";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");
const NOW = 100;

const NAMES = {
  abyssal_mask: "Abyssal Mask",
  statikk_shiv: "Statikk Shiv",
  serpents_fang: "Serpent's Fang",
  plated_steelcaps: "Plated Steelcaps",
};

function champion(over: Partial<ChampionState> = {}): ChampionState {
  return makeChampion("korvan", "blue", 0.3, 0.3, {
    name: "KORVAN",
    role: "TOP",
    level: 8,
    hp: 640,
    maxHp: 1200,
    kills: 3,
    deaths: 1,
    assists: 2,
    cs: 71,
    gold: 400,
    spentGold: 2600,
    items: ["abyssal_mask", "statikk_shiv"],
    summonerSpells: [
      { key: "flash", cdUntil: 0 },
      { key: "ignite", cdUntil: 160 },
    ],
    ultimate: { archetype: "burst", icon: "", cdUntil: 113 },
    ...over,
  });
}

const opponent = (over: Partial<ChampionState> = {}) =>
  makeChampion("ruvia", "red", 0.7, 0.7, { name: "RUVIA", role: "TOP", gold: 100, spentGold: 1700, ...over });

function props(over: Partial<LivePlayerCardProps> = {}): LivePlayerCardProps {
  return {
    champion: champion(),
    opponent: opponent(),
    championName: "Ambessa",
    nowSec: NOW,
    fighting: false,
    selected: false,
    itemNames: NAMES,
    onSelect: () => {},
    ...over,
  };
}

const card = () => screen.getByRole("button");
const description = () => document.getElementById(card().getAttribute("aria-describedby") ?? "")?.textContent ?? "";

describe("the card as a control", () => {
  it("is a native button with a short name that holds none of the stats", () => {
    render(<LivePlayerCard {...props()} />);
    expect(card().tagName).toBe("BUTTON");
    expect(card()).toHaveAccessibleName("Spotlight KORVAN on the map: Ambessa, Top");
    expect(card()).not.toHaveAccessibleName(/\d/);
  });

  it("drops the champion from the name when it is not known", () => {
    render(<LivePlayerCard {...props({ championName: undefined })} />);
    expect(card()).toHaveAccessibleName("Spotlight KORVAN on the map: Top");
  });

  it("names the jungle and the support roles in words", () => {
    render(<LivePlayerCard {...props({ champion: champion({ role: "JGL" }), opponent: opponent({ role: "JGL" }) })} />);
    expect(card()).toHaveAccessibleName("Spotlight KORVAN on the map: Ambessa, Jungle");
  });

  it("reports whether it is pressed, and a second press clears it", () => {
    function Harness() {
      const [id, setId] = useState<string | null>(null);
      return <LivePlayerCard {...props({ selected: id === "korvan", onSelect: (next) => setId((prev) => (prev === next ? null : next)) })} />;
    }
    render(<Harness />);
    expect(card()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(card());
    expect(card()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(card());
    expect(card()).toHaveAttribute("aria-pressed", "false");
  });

  it("tells the app which player was pressed", () => {
    const onSelect = vi.fn();
    render(<LivePlayerCard {...props({ onSelect })} />);
    fireEvent.click(card());
    expect(onSelect).toHaveBeenCalledWith("korvan");
  });

  it("gives every card its own description id", () => {
    render(
      <>
        <LivePlayerCard {...props()} />
        <LivePlayerCard {...props({ champion: champion({ id: "other" }) })} />
      </>,
    );
    const ids = screen.getAllByRole("button").map((button) => button.getAttribute("aria-describedby"));
    expect(new Set(ids).size).toBe(2);
  });

  it("follows the team: round blue, mirrored red", () => {
    const { rerender } = render(<LivePlayerCard {...props()} />);
    expect(card()).toHaveAttribute("data-team", "blue");
    rerender(<LivePlayerCard {...props({ champion: champion({ team: "red" }) })} />);
    expect(card()).toHaveAttribute("data-team", "red");
    expect(css).toMatch(/\.arena-card\[data-team="red"\] \.arena-card-face\s*\{[^}]*border-radius:\s*32%/);
  });
});

describe("what the card shows", () => {
  it("shows the name, role, level, KDA, farm and total gold", () => {
    render(<LivePlayerCard {...props()} />);
    expect(screen.getByText("KORVAN")).toBeInTheDocument();
    expect(screen.getByText("Top")).toBeInTheDocument();
    expect(screen.getByText("LV 8")).toBeInTheDocument();
    expect(screen.getByText("3/1/2")).toBeInTheDocument();
    expect(card()).toHaveTextContent("71 CS 3.0k");
    expect(card()).toHaveTextContent("640/1200");
  });

  it("has no mana bar", () => {
    const { container } = render(<LivePlayerCard {...props()} />);
    expect(container.querySelector("[class*='mana'], [class*='mp'], [role='meter']")).toBeNull();
    expect(container.textContent).not.toMatch(/mana/i);
  });

  it("shows the gold gap with its sign, or the word for even", () => {
    const { rerender } = render(<LivePlayerCard {...props()} />);
    expect(screen.getByTestId("card-gap")).toHaveTextContent("+1.2k");
    expect(screen.getByTestId("card-gap")).toHaveAttribute("data-direction", "ahead");

    rerender(<LivePlayerCard {...props({ opponent: opponent({ spentGold: 3500 }) })} />);
    expect(screen.getByTestId("card-gap")).toHaveTextContent("−600");
    expect(screen.getByTestId("card-gap")).toHaveAttribute("data-direction", "behind");

    rerender(<LivePlayerCard {...props({ opponent: opponent({ spentGold: 2900, gold: 100 }) })} />);
    expect(screen.getByTestId("card-gap")).toHaveTextContent("Even");
  });

  it("shows no gap when nobody stands opposite", () => {
    render(<LivePlayerCard {...props({ opponent: undefined })} />);
    expect(screen.queryByTestId("card-gap")).toBeNull();
  });

  it("draws six item slots: the bought items first and dashed empty ones after", () => {
    render(<LivePlayerCard {...props()} />);
    const slots = card().querySelectorAll(".arena-item");
    expect(slots).toHaveLength(6);
    expect([...slots].map((slot) => slot.hasAttribute("data-empty"))).toEqual([false, false, true, true, true, true]);
    expect(slots[0]).toHaveAttribute("title", "Abyssal Mask");
    expect(slots[0].querySelector("img")).toHaveAttribute("src", "/lol-item-icons/abyssal_mask.png");
  });

  it("lists the cooldowns with a letter, the seconds while cooling down and a solid outline when ready", () => {
    render(<LivePlayerCard {...props()} />);
    const chips = screen.getAllByTestId("card-cd");
    expect(chips.map((chip) => chip.textContent)).toEqual(["R 13", "F", "I 60"]);
    expect(chips.map((chip) => chip.hasAttribute("data-ready"))).toEqual([false, true, false]);
    expect(chips[1]).toHaveAttribute("title", "Flash ready");
    expect(chips[2]).toHaveAttribute("title", "Ignite ready in 60 seconds");
  });

  it("shows the state as text: lane, fighting, recall or dead", () => {
    const { rerender } = render(<LivePlayerCard {...props()} />);
    expect(screen.getByTestId("card-state")).toHaveTextContent("In lane");

    rerender(<LivePlayerCard {...props({ fighting: true })} />);
    expect(screen.getByTestId("card-state")).toHaveTextContent("Fighting");

    rerender(<LivePlayerCard {...props({ champion: champion({ state: "recall", recallChannelUntil: 103.9 }) })} />);
    expect(screen.getByTestId("card-state")).toHaveTextContent("Recall 3.9s");

    rerender(<LivePlayerCard {...props({ champion: champion({ alive: false, hp: 0, respawnAt: 114.2 }) })} />);
    expect(screen.getByTestId("card-state")).toHaveTextContent("Dead 15s");
    expect(screen.getByTestId("card-respawn")).toHaveTextContent("15");
    expect(card()).toHaveAttribute("data-dead");
    expect(css).toMatch(/\.arena-card\[data-dead\]\s*\{[^}]*border-style:\s*dashed/);
  });
});

describe("the description a screen reader hears", () => {
  it("holds level, health, KDA, farm, gold, gap, items and cooldowns", () => {
    render(<LivePlayerCard {...props()} />);
    const text = description();
    expect(text).toContain("Level 8");
    expect(text).toContain("640 of 1200 health");
    expect(text).toContain("In lane");
    expect(text).toContain("Kills 3, deaths 1, assists 2");
    expect(text).toContain("71 minions killed");
    expect(text).toContain("Total gold 3.0k");
    expect(text).toContain("1.2k ahead of the opposing Top");
    expect(text).toContain("Items: Abyssal Mask, Statikk Shiv, 4 empty slots");
    expect(text).toContain("Cooldowns: Ultimate ready in 13 seconds, Flash ready, Ignite ready in 60 seconds");
  });

  it("names every item with its real name, so two items never share a short code", () => {
    render(
      <LivePlayerCard
        {...props({ champion: champion({ items: ["statikk_shiv", "serpents_fang", "plated_steelcaps", "abyssal_mask"] }) })}
      />,
    );
    const text = description();
    for (const name of ["Statikk Shiv", "Serpent's Fang", "Plated Steelcaps", "Abyssal Mask"]) expect(text).toContain(name);
    expect(text).toContain("2 empty slots");
  });

  it("falls back to the humanised key until the item names have loaded", () => {
    render(<LivePlayerCard {...props({ itemNames: null, champion: champion({ items: ["plated_steelcaps"] }) })} />);
    expect(description()).toContain("Items: Plated Steelcaps, 5 empty slots");
  });

  it("says when there are no items, and an even gap", () => {
    render(
      <LivePlayerCard {...props({ champion: champion({ items: [], spentGold: 1800 }), opponent: opponent({ spentGold: 2100, gold: 100 }) })} />,
    );
    const text = description();
    expect(text).toContain("No items");
    expect(text).not.toContain("empty slot");
    expect(text).toContain("even with the opposing Top");
  });

  it("says a dead champion is back in so many seconds, instead of its health", () => {
    render(<LivePlayerCard {...props({ champion: champion({ alive: false, hp: 0, respawnAt: 101 }) })} />);
    const text = description();
    expect(text).toContain("Dead, back in 1 second");
    expect(text).not.toContain("of 1200 health");
  });

  it("is hidden from the eye and not part of the button name", () => {
    render(<LivePlayerCard {...props()} />);
    const node = document.getElementById(card().getAttribute("aria-describedby") ?? "");
    expect(node).toHaveClass("sr-only");
    expect(within(card()).getByText(/Level 8/, { selector: ".sr-only" })).toBe(node);
  });
});

describe("LivePlayerCard in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish and shows no raw key", () => {
    const { container } = render(<LivePlayerCard {...props({ fighting: true })} />);
    expect(card()).toHaveAccessibleName("Seguir a KORVAN en el mapa: Ambessa, Top");
    expect(screen.getByText("Nv. 8")).toBeInTheDocument();
    expect(screen.getByTestId("card-state")).toHaveTextContent("Peleando");
    expect(screen.getByTestId("card-gap")).toHaveTextContent("+1,2k");
    const text = description();
    expect(text).toContain("Nivel 8");
    expect(text).toContain("640 de 1200 de vida");
    expect(text).toContain("Asesinatos 3, muertes 1, asistencias 2");
    expect(text).toContain("71 súbditos eliminados");
    expect(text).toContain("Oro total 3,0k");
    expect(text).toContain("1,2k por delante de su rival de Top");
    expect(text).toContain("Objetos: Abyssal Mask, Statikk Shiv, 4 huecos vacíos");
    expect(text).toContain("Definitiva listo en 13 segundos");
    expect(container.textContent).not.toMatch(/onAir\.|championPage\./);
  });
});
