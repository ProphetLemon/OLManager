import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { FeedSourceEvent, RosterEntry } from "@/lib/match/live/liveEvents";

import { EventTicker, FEED_LIMIT } from "./EventTicker";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

const ROSTER: RosterEntry[] = [
  { id: "korvan", name: "KORVAN", team: "blue" },
  { id: "ruvia", name: "RUVIA", team: "red" },
];

const ev = (t: number, text: string, type: string): FeedSourceEvent => ({ t, text, type });

const KILL = ev(723, "KORVAN killed RUVIA (tower)", "kill");
const LIST_NAME = "Event feed, newest first. Use the arrow keys to scroll.";

const TAGS = { blue: "KT.C", red: "EMB" };

function renderTicker(events: FeedSourceEvent[], limit?: number, teamNames?: typeof TAGS) {
  const view = render(<EventTicker events={events} roster={ROSTER} limit={limit} teamNames={teamNames} />);
  return {
    ...view,
    rerenderWith: (next: FeedSourceEvent[]) => view.rerender(<EventTicker events={next} roster={ROSTER} limit={limit} teamNames={teamNames} />),
  };
}

const items = () => screen.getAllByRole("listitem");
const status = () => screen.getByRole("status");

describe("what each event says", () => {
  it("shows a kill with initials, names and the cause, and tells a screen reader it was an elimination", () => {
    renderTicker([KILL]);
    const [item] = items();
    expect(within(item).getByText("12:03")).toBeInTheDocument();
    expect(within(item).getByText("KO")).toHaveAttribute("data-team", "blue");
    expect(within(item).getByText("RU")).toHaveAttribute("data-team", "red");
    expect(within(item).getByText("(tower)")).toBeInTheDocument();
    expect(within(item).getByText("KORVAN eliminated RUVIA (tower)", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("shows a kill without a cause as a plain elimination", () => {
    renderTicker([ev(90, "RUVIA killed KORVAN", "kill")]);
    expect(within(items()[0]).queryByText(/^\(/)).toBeNull();
    expect(within(items()[0]).getByText("RUVIA eliminated KORVAN", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("shows an ignite kill", () => {
    renderTicker([ev(300, "KORVAN ignited RUVIA", "kill")]);
    expect(within(items()[0]).getByText("KORVAN ignited RUVIA", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("shows a tower and the nexus with the part and the lane in words", () => {
    renderTicker([ev(600, "BLUE destroyed red-top-outer", "tower"), ev(2000, "BLUE destroyed red-nexus", "nexus")]);
    expect(screen.getByText("Blue destroyed the outer turret (top)")).toBeInTheDocument();
    expect(screen.getByText("Blue destroyed the nexus")).toBeInTheDocument();
  });

  it("shows the dragon by kind, the Elder and Baron", () => {
    renderTicker([
      ev(400, "BLUE secured infernal dragon", "dragon"),
      ev(1800, "RED secured elder dragon", "dragon"),
      ev(1500, "RED secured Baron", "baron"),
    ]);
    expect(screen.getByText("Blue secured the Infernal Dragon")).toBeInTheDocument();
    expect(screen.getByText("Red secured the Elder Dragon")).toBeInTheDocument();
    expect(screen.getByText("Red secured Baron")).toBeInTheDocument();
  });

  it("shows grubs and the herald, which the engine logs as info, as objectives with their glyph", () => {
    renderTicker([ev(500, "BLUE cleared voidgrub camp", "info"), ev(900, "RED secured rift herald", "info")]);
    const [herald, grubs] = items();
    expect(within(herald).getByText("Red secured the Rift Herald")).toBeInTheDocument();
    expect(herald.querySelector("img")).toHaveAttribute("src", expect.stringContaining("riftherald"));
    expect(within(grubs).getByText("Blue cleared the voidgrub camp")).toBeInTheDocument();
    expect(grubs.querySelector("img")).toHaveAttribute("src", expect.stringContaining("grub"));
    expect(herald).toHaveAttribute("data-kind", "objective");
  });

  it("names the club by its tag on every objective line when the screen knows the clubs", () => {
    renderTicker(
      [
        ev(100, "BLUE secured Scuttle Top", "info"),
        ev(200, "RED secured rift herald", "info"),
        ev(300, "BLUE cleared voidgrub camp", "info"),
        ev(400, "BLUE secured infernal dragon", "dragon"),
        ev(500, "RED secured elder dragon", "dragon"),
        ev(600, "RED secured Baron", "baron"),
        ev(700, "BLUE destroyed red-top-outer", "tower"),
        ev(800, "RED destroyed blue-nexus", "nexus"),
      ],
      undefined,
      TAGS,
    );
    expect(screen.getByText("KT.C killed the Scuttle Crab")).toBeInTheDocument();
    expect(screen.getByText("EMB secured the Rift Herald")).toBeInTheDocument();
    expect(screen.getByText("KT.C cleared the voidgrub camp")).toBeInTheDocument();
    expect(screen.getByText("KT.C secured the Infernal Dragon")).toBeInTheDocument();
    expect(screen.getByText("EMB secured the Elder Dragon")).toBeInTheDocument();
    expect(screen.getByText("EMB secured Baron")).toBeInTheDocument();
    expect(screen.getByText("KT.C destroyed the outer turret (top)")).toBeInTheDocument();
    expect(screen.getByText("EMB destroyed the nexus")).toBeInTheDocument();
    expect(screen.queryByText(/A team/i)).toBeNull();
  });

  it("does not report a scuttle crab nobody took when its camp despawns", () => {
    renderTicker([ev(100, "Scuttle Top despawned", "info"), ev(110, "Scuttle Bot despawned", "info")], undefined, TAGS);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("falls back to the engine text for a line it cannot read", () => {
    renderTicker([ev(77, "BLUE destroyed", "tower")]);
    expect(screen.getByText("BLUE destroyed")).toBeInTheDocument();
  });

  it("leaves out spawns, recalls and info lines that are not objectives", () => {
    renderTicker([ev(10, "KORVAN recalled", "recall"), ev(20, "minions spawned", "spawn"), ev(30, "wave cleared", "info"), KILL]);
    expect(items()).toHaveLength(1);
  });
});

describe("the list", () => {
  it("is newest first", () => {
    renderTicker([ev(100, "RUVIA killed KORVAN", "kill"), ev(200, "KORVAN killed RUVIA", "kill"), ev(300, "BLUE secured Baron", "baron")]);
    expect(items().map((item) => within(item).getByText(/^\d+:\d\d$/).textContent)).toEqual(["5:00", "3:20", "1:40"]);
  });

  it("can be focused from the keyboard and has a name", () => {
    renderTicker([KILL]);
    const list = screen.getByRole("list", { name: LIST_NAME });
    expect(list).toHaveAttribute("tabindex", "0");
    expect(css).toMatch(/\.arena-tk-list\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("is a named region that holds the list", () => {
    renderTicker([KILL]);
    expect(within(screen.getByRole("region", { name: "Kills and objectives" })).getByRole("list")).toBeInTheDocument();
  });

  it("says it is waiting when nothing has happened, and draws no list", () => {
    renderTicker([]);
    expect(screen.getByText("Waiting for first skirmish...")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(status()).toHaveTextContent("");
  });

  it("shows eight entries however long the engine log is", () => {
    const log = Array.from({ length: 200 }, (_, index) => ev(index * 10, "KORVAN killed RUVIA", "kill"));
    renderTicker(log);
    expect(items()).toHaveLength(FEED_LIMIT);
    expect(FEED_LIMIT).toBe(8);
    expect(within(items()[0]).getByText("33:10")).toBeInTheDocument();
  });

  it("keeps one live region and one hidden sentence per shown kill, however long the log is", () => {
    const log = Array.from({ length: 200 }, (_, index) => ev(index * 10, "KORVAN killed RUVIA", "kill"));
    const { container } = renderTicker(log);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelectorAll(".arena-tk-list .sr-only")).toHaveLength(FEED_LIMIT);
    expect(container.querySelectorAll(".arena-ticker > .sr-only")).toHaveLength(1);
  });

  it("keeps an entry's element when later events arrive, so nothing remounts", () => {
    const first = [ev(100, "KORVAN killed RUVIA", "kill")];
    const { rerenderWith } = renderTicker(first);
    const before = items()[0];
    rerenderWith([...first, ev(150, "BLUE secured Baron", "baron")]);
    expect(items()).toHaveLength(2);
    expect(items()[1]).toBe(before);
  });
});

describe("the live region", () => {
  it("announces the newest event with its time, and only that", () => {
    renderTicker([ev(100, "RUVIA killed KORVAN", "kill"), KILL]);
    expect(status()).toHaveTextContent("Latest, 12:03: KORVAN eliminated RUVIA (tower)");
    expect(status()).toHaveAttribute("aria-live", "polite");
    expect(status()).toHaveAttribute("aria-atomic", "true");
    expect(status()).toHaveClass("sr-only");
    expect(screen.getByRole("list")).not.toHaveAttribute("aria-live");
  });

  it("is not touched by commits that bring no new event", () => {
    const log = [ev(100, "RUVIA killed KORVAN", "kill"), KILL];
    const { rerenderWith } = renderTicker(log);
    const observer = new MutationObserver(() => {});
    observer.observe(status(), { subtree: true, childList: true, characterData: true, attributes: true });

    for (let commit = 0; commit < 10; commit += 1) {
      // A fresh array each time, like a fresh engine answer, with the same events and a silent recall line.
      rerenderWith([...log, ev(724 + commit, "KORVAN recalled", "recall")]);
    }
    // Records are delivered asynchronously; take the pending ones before disconnecting.
    const records = observer.takeRecords();
    observer.disconnect();
    expect(records).toEqual([]);
    expect(status()).toHaveTextContent("Latest, 12:03: KORVAN eliminated RUVIA (tower)");
  });

  it("changes when a new event arrives", () => {
    const log = [KILL];
    const { rerenderWith } = renderTicker(log);
    rerenderWith([...log, ev(800, "RED secured Baron", "baron")]);
    expect(status()).toHaveTextContent("Latest, 13:20: Red secured Baron");
  });
});

describe("motion", () => {
  it("fades the newest entry in and no older one", () => {
    renderTicker([ev(100, "RUVIA killed KORVAN", "kill"), KILL]);
    const [newest, older] = items();
    expect(newest).toHaveAttribute("data-new");
    expect(older).not.toHaveAttribute("data-new");
  });

  it("fades with opacity alone", () => {
    const keyframes = css.match(/@keyframes arena-tk-in\s*\{((?:[^{}]|\{[^{}]*\})*)\}/)?.[1] ?? "";
    expect(keyframes).toMatch(/opacity/);
    const properties = [...keyframes.matchAll(/([\w-]+)\s*:/g)].map((match) => match[1]);
    expect([...new Set(properties)]).toEqual(["opacity"]);
  });

  it("removes the slide-in for people who ask for less motion", () => {
    const block = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/\.arena-tk\[data-new\]\s*\{\s*animation:\s*none/);
  });
});

describe("EventTicker in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish and shows no raw key", () => {
    const { container } = renderTicker([
      KILL,
      ev(2000, "BLUE destroyed red-mid-inhib-tower", "tower"),
      ev(2100, "RED secured infernal dragon", "dragon"),
      ev(2200, "BLUE secured rift herald", "info"),
    ]);
    expect(screen.getByRole("list", { name: /^Registro de eventos/ })).toBeInTheDocument();
    expect(screen.getByText("Azul destruyó la torre del inhibidor (central)")).toBeInTheDocument();
    expect(screen.getByText("Rojo aseguró el Dragón infernal")).toBeInTheDocument();
    expect(screen.getByText("Azul aseguró el Heraldo de la Grieta")).toBeInTheDocument();
    expect(screen.getByText("(torre)")).toBeInTheDocument();
    expect(status()).toHaveTextContent("Último, 36:40: Azul aseguró el Heraldo de la Grieta");
    expect(container.textContent).not.toMatch(/onAir\.match\./);
  });

  it("uses the existing words for the empty state", () => {
    renderTicker([]);
    expect(screen.getByText("Esperando la primera escaramuza...")).toBeInTheDocument();
  });
});
