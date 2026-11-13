import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { buildSpotlight, type SpotlightPit } from "@/lib/match/live/spotlight";

import { NOW, TOWER_ON_R1, busyMoment, champ, moment } from "./engagementFixtures.testing";
import { SpotlightCaption } from "./SpotlightCaption";
import { MAX_CHIPS } from "./spotlightText";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

const caption = () => screen.getByTestId("spotlight-caption");
const sentence = () => caption().querySelector(".arena-sp-line")?.textContent;
const kind = () => caption().querySelector(".arena-sp-kind")?.textContent;
const chips = () => within(caption()).queryAllByRole("listitem");

const DRAGON_PIT: SpotlightPit = {
  id: "dragon",
  pos: { x: 674, y: 703 },
  alive: true,
  entity: "dragon",
  dragonKind: "mountain",
  hpPct: 55,
};

function renderCaption(context = busyMoment(), pinnedId?: string | null, onRelease?: () => void) {
  return render(<SpotlightCaption spotlight={buildSpotlight(context, pinnedId)} onRelease={onRelease} />);
}

describe("the headline sentence", () => {
  it("names a fight and shows the other engagements as chips with their kind", () => {
    renderCaption();
    expect(kind()).toBe("Fight");
    expect(sentence()).toBe("B1 and R1 are fighting");
    expect(chips().map((chip) => chip.textContent)).toEqual([
      "Towerthe outer turret (top) on R1",
      "RecallR3, 4s left",
      "HitB2 hit R2",
      "DownB3 back in 22s",
    ]);
  });

  it("counts the hits of a tower, with the singular for one", () => {
    renderCaption(moment([champ("r1", "red")], { structures: [TOWER_ON_R1] }));
    expect(kind()).toBe("Tower");
    expect(sentence()).toBe("R1 is under fire from the outer turret (top), 3 hits in a row");
    renderCaption(moment([champ("r1", "red")], { structures: [{ ...TOWER_ON_R1, rampShots: 0 }] }));
    expect(screen.getAllByTestId("spotlight-caption")[1].querySelector(".arena-sp-line")?.textContent).toBe(
      "R1 was hit by the outer turret (top)",
    );
  });

  it("rounds a recall up to whole seconds and uses the singular for one", () => {
    renderCaption(moment([champ("r3", "red", { state: "recall", recallChannelUntil: NOW + 3.9 })]));
    expect(sentence()).toBe("R3 is recalling, 4 seconds left");
    renderCaption(moment([champ("r3", "red", { state: "recall", recallChannelUntil: NOW + 0.5 })]));
    expect(screen.getAllByTestId("spotlight-caption")[1].querySelector(".arena-sp-line")?.textContent).toBe(
      "R3 is recalling, 1 second left",
    );
  });

  it("says who is on an objective and its health, in the plural when two are there", () => {
    const at = { x: 0.674, y: 0.703 };
    renderCaption(
      moment([champ("b1", "blue", { state: "objective", pos: at })], { pits: [DRAGON_PIT] }),
    );
    expect(kind()).toBe("Objective");
    expect(sentence()).toBe("B1 is taking Mountain Dragon, 55% health left");
    renderCaption(
      moment(
        [champ("b1", "blue", { state: "objective", pos: at }), champ("b2", "blue", { state: "objective", pos: at })],
        { pits: [DRAGON_PIT] },
      ),
    );
    expect(screen.getAllByTestId("spotlight-caption")[1].querySelector(".arena-sp-line")?.textContent).toBe(
      "B1 and B2 are taking Mountain Dragon, 55% health left",
    );
  });

  it("says the match is over when a nexus has fallen", () => {
    renderCaption(moment([champ("b1", "blue")], { winner: "blue", structures: [{ id: "red-nexus", team: "red", kind: "nexus", alive: false }] }));
    expect(kind()).toBe("Game over");
    expect(sentence()).toBe("Blue destroyed the nexus and won the match");
  });

  it("is quiet when nothing is happening: no chips, no button", () => {
    renderCaption(moment([champ("b1", "blue"), champ("r1", "red")]), null, vi.fn());
    expect(kind()).toBe("Quiet");
    expect(sentence()).toBe("Quiet on the map. Nobody is fighting.");
    expect(chips()).toEqual([]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the kind as a bordered word and is not a live region", () => {
    renderCaption();
    expect(css).toMatch(/\.arena-sp-kind,[^{]*\{[^}]*border: 1px solid var\(--foreground\)/);
    expect(caption().querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(caption()).toHaveAccessibleName("Spotlight");
  });
});

describe("the other engagements", () => {
  it("shows at most MAX_CHIPS and counts the rest", () => {
    const dead = Array.from({ length: 9 }, (_, i) => champ(`d${i}`, "red", { alive: false, respawnAt: NOW + 10 + i }));
    renderCaption(moment([champ("b1", "blue"), ...dead]));
    const items = chips();
    expect(items).toHaveLength(MAX_CHIPS + 1);
    // Nine are down: one is the headline, eight are chips, six are shown and two are counted.
    expect(items[MAX_CHIPS]).toHaveTextContent(/^2 more$/);
  });
});

describe("following a player", () => {
  it("replaces the headline, shows the player's level and health, and keeps every engagement as a chip", () => {
    const context = busyMoment();
    context.champions = context.champions.map((c) => (c.id === "b1" ? { ...c, state: "fight" } : c));
    renderCaption(context, "b1", vi.fn());
    expect(kind()).toBe("Following");
    expect(sentence()).toBe("Following B1: in a fight");
    expect(caption()).toHaveTextContent("Level 6, 80% health");
    expect(chips().length).toBeGreaterThanOrEqual(4);
  });

  it("describes a followed player who is dead or recalling with the seconds", () => {
    renderCaption(busyMoment(), "b3", vi.fn());
    expect(sentence()).toBe("Following B3: dead, back in 22 seconds");
    renderCaption(busyMoment(), "r3", vi.fn());
    expect(screen.getAllByTestId("spotlight-caption")[1].querySelector(".arena-sp-line")?.textContent).toBe(
      "Following R3: recalling, 4 seconds left",
    );
  });

  it("offers Stop following with the player's name and calls onRelease once", () => {
    const onRelease = vi.fn();
    renderCaption(busyMoment(), "b4", onRelease);
    fireEvent.click(screen.getByRole("button", { name: "Stop following B4" }));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("returns the caption to the automatic engagement once released", () => {
    function Harness() {
      const [pinned, setPinned] = useState<string | null>("b4");
      return <SpotlightCaption spotlight={buildSpotlight(busyMoment(), pinned)} onRelease={() => setPinned(null)} />;
    }
    render(<Harness />);
    expect(sentence()).toBe("Following B4: in lane");
    fireEvent.click(screen.getByRole("button", { name: "Stop following B4" }));
    expect(sentence()).toBe("B1 and R1 are fighting");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish and shows no raw key", () => {
    const { container } = renderCaption();
    expect(kind()).toBe("Pelea");
    expect(sentence()).toBe("B1 y R1 están peleando");
    expect(chips().map((chip) => chip.textContent)).toContain("Torrela torre exterior (superior) sobre R1");
    expect(chips().map((chip) => chip.textContent)).toContain("RegresoR3, quedan 4s");
    expect(container.textContent).not.toMatch(/onAir\.match\./);
  });

  it("uses the Spanish plural for seconds and the followed player", () => {
    renderCaption(moment([champ("r3", "red", { state: "recall", recallChannelUntil: NOW + 0.5 })]));
    expect(sentence()).toBe("R3 está volviendo a la base, queda 1 segundo");
    renderCaption(busyMoment(), "b4", vi.fn());
    expect(screen.getAllByTestId("spotlight-caption")[1].querySelector(".arena-sp-line")?.textContent).toBe(
      "Siguiendo a B4: en su línea",
    );
    expect(screen.getByRole("button", { name: "Dejar de seguir a B4" })).toBeInTheDocument();
  });
});
