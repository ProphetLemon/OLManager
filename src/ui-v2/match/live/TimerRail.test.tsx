import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { ObjectivesStateLike, TimerLike } from "@/lib/match/live/objectivesView";
import { teamIdentity } from "@/lib/match/live/teamIdentity";

import { TimerRail } from "./TimerRail";

const BLUE = teamIdentity("Emberfall", [{ name: "Emberfall", short_name: "EMB" }]);
const RED = teamIdentity("Tidal Lanterns", [{ name: "Tidal Lanterns", short_name: "TDL" }]);

function state(over: { entities?: Record<string, TimerLike>; extra?: Record<string, unknown>; time?: number } = {}): ObjectivesStateLike {
  return {
    timeSec: over.time ?? 1270,
    objectives: { dragon: { alive: false, nextSpawnAt: 1500, currentKind: "mountain" }, baron: { alive: false, nextSpawnAt: 1700 } },
    neutralTimers: {
      elderUnlocked: false,
      entities: {
        dragon: { alive: false, nextSpawnAt: 1500, unlocked: true },
        voidgrubs: { alive: false, nextSpawnAt: null },
        herald: { alive: false, nextSpawnAt: 1400 },
        baron: { alive: false, nextSpawnAt: 1700 },
        elder: { alive: false, nextSpawnAt: null, unlocked: false },
        ...over.entities,
      },
    },
    ...over.extra,
  } as ObjectivesStateLike;
}

const rail = () => screen.getByTestId("timer-rail");
const tile = (id: string) => rail().querySelector(`[data-timer="${id}"]`) as HTMLElement;

describe("the timer rail", () => {
  it("is a named list of the same four tiles in the same order, from the first minute to the last", () => {
    render(<TimerRail state={state()} blue={BLUE} red={RED} />);
    expect(rail().tagName).toBe("UL");
    expect(rail()).toHaveAccessibleName("Objective timers");
    expect([...rail().children].map((el) => el.getAttribute("data-timer"))).toEqual(["dragon", "voidgrubs", "herald", "baron"]);
  });

  it("names each monster and counts down to it, or says Gone when its time is over", () => {
    render(<TimerRail state={state()} blue={BLUE} red={RED} />);
    expect(tile("dragon")).toHaveTextContent("Mountain Dragon3:50");
    expect(tile("voidgrubs")).toHaveTextContent("VoidgrubsGone");
    expect(tile("herald")).toHaveTextContent("Herald2:10");
    expect(tile("baron")).toHaveTextContent("Baron7:10");
  });

  it("shows health while a monster is up, with a heavy frame flag, and a dashed one flag for Gone", () => {
    render(<TimerRail state={state({ entities: { baron: { alive: true, hp: 54, maxHp: 100, nextSpawnAt: 1200 } } })} blue={BLUE} red={RED} />);
    expect(tile("baron")).toHaveTextContent("Up 54%");
    expect(tile("baron")).toHaveAttribute("data-status", "alive");
    expect(tile("voidgrubs")).toHaveAttribute("data-status", "none");
    expect(tile("dragon")).toHaveAttribute("data-status", "countdown");
  });

  it("swaps the dragon tile for the Elder once it is unlocked", () => {
    const elder = state({ entities: { dragon: { alive: false, nextSpawnAt: null, unlocked: false }, elder: { alive: false, nextSpawnAt: 1450, unlocked: true } } });
    elder.neutralTimers!.elderUnlocked = true;
    render(<TimerRail state={elder} blue={BLUE} red={RED} />);
    expect(tile("dragon")).toHaveTextContent("Elder Dragon3:00");
  });

  it("tags the tile that gave a running buff with the holder and the time left, and names it in full", () => {
    render(<TimerRail state={state({ extra: { teamBuffs: { blue: { baron_until: 1270 + 48 }, red: { elder_until: 1270 + 70 } } } })} blue={BLUE} red={RED} />);
    const baron = within(tile("baron")).getByRole("img", { name: "Baron buff, Emberfall: 0:48 left" });
    expect(baron).toHaveTextContent("EMB 0:48");
    expect(baron).toHaveAttribute("data-team", "blue");
    const elder = within(tile("dragon")).getByRole("img", { name: "Elder Dragon buff, Tidal Lanterns: 1:10 left" });
    expect(elder).toHaveAttribute("data-team", "red");
    expect(within(tile("herald")).queryByRole("img")).toBeNull();
  });

  it("tags the Herald with the side that carries it", () => {
    render(<TimerRail state={state({ extra: { heraldTeam: "red", heraldCarrierId: "r3" } })} blue={BLUE} red={RED} />);
    expect(within(tile("herald")).getByRole("img", { name: "Herald carried by Tidal Lanterns" })).toHaveTextContent("TDL");
  });

  it("is not a live region, and draws no inhibitor timer, which the engine does not send", () => {
    render(<TimerRail state={state()} blue={BLUE} red={RED} />);
    expect(rail().querySelector("[aria-live], [role='status']")).toBeNull();
    expect(rail().textContent).not.toMatch(/inhibitor/i);
  });
});

describe("the timer rail in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish and shows no raw key", () => {
    const { container } = render(<TimerRail state={state({ extra: { teamBuffs: { blue: { baron_until: 1318 } } } })} blue={BLUE} red={RED} />);
    expect(rail()).toHaveAccessibleName("Temporizadores de objetivos");
    expect(tile("voidgrubs")).toHaveTextContent("Terminado");
    expect(within(tile("baron")).getByRole("img")).toHaveAccessibleName(/^Mejora de .*, Emberfall: quedan 0:48$/);
    expect(container.textContent).not.toMatch(/onAir\.match\./);
  });
});
