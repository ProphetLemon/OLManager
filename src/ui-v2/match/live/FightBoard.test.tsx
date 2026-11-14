import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { buildFightBoard, type FightBoardRow } from "@/lib/match/live/fightBoard";

import { NOW, TOWER_ON_R1, busyMoment, champ, moment } from "./engagementFixtures.testing";
import { AWAY_BOARD_ID, FIGHT_BOARD_ID, FightBoard, VISIBLE_ROWS } from "./FightBoard";

const fights = () => screen.getByTestId("fight-board");
const away = () => screen.getByTestId("away-board");
const rowsOf = (strip: HTMLElement) => within(strip).getAllByRole("listitem").filter((row) => row.dataset.rowId);
const fullTexts = (strip: HTMLElement) => rowsOf(strip).map((row) => row.querySelector(".arena-board-text")?.textContent);
const shortTexts = (strip: HTMLElement) => rowsOf(strip).map((row) => row.querySelector(".arena-board-short")?.textContent);
const kindTexts = (strip: HTMLElement) => rowsOf(strip).map((row) => row.querySelector(".arena-board-kind")?.textContent);

const busyRows = () => buildFightBoard(busyMoment());

function both(rows: readonly FightBoardRow[]) {
  return render(
    <>
      <FightBoard rows={rows} variant="fights" />
      <FightBoard rows={rows} variant="away" />
    </>,
  );
}

describe("what the strips say", () => {
  it("puts contacts and tower fire on the fights strip, in the board's order, with the team in words in each sentence", () => {
    both(busyRows());
    expect(kindTexts(fights())).toEqual(["Fighting", "Fighting", "Tower"]);
    expect(fullTexts(fights())).toEqual([
      "B1 (Blue) and R1 (Red) are trading hits, last hit 1 second ago",
      "B2 (Blue) is hitting R2 (Red), last hit 2 seconds ago",
      "R1 (Red) is under fire from the outer turret (top), 3 hits in a row",
    ]);
  });

  it("puts recalls and deaths on the away strip", () => {
    both(busyRows());
    expect(kindTexts(away())).toEqual(["Recall", "Dead"]);
    expect(fullTexts(away())).toEqual(["R3 (Red) is recalling, 4 seconds left", "B3 (Blue) is dead and returns in 22 seconds"]);
  });

  it("shows each row in a few words beside the chip, and hides those words from assistive technology, which has the sentence", () => {
    both(busyRows());
    expect(shortTexts(fights())).toEqual(["B1 vs R1", "B2 hits R2", "Tower fire on R1"]);
    expect(shortTexts(away())).toEqual(["R3 recalls, 4s", "B3 back in 22s"]);
    for (const row of rowsOf(fights())) {
      expect(row.querySelector(".arena-board-short")).toHaveAttribute("aria-hidden", "true");
      expect(row.querySelector(".arena-board-text")).not.toHaveAttribute("aria-hidden");
    }
  });

  it("uses the singular for one hit and one second", () => {
    const quick = moment(
      [
        champ("r1", "red", { alive: false, respawnAt: NOW + 0.4 }),
        champ("r2", "red", { state: "recall", recallChannelUntil: NOW + 0.5 }),
        champ("b1", "blue"),
      ],
      { structures: [{ ...TOWER_ON_R1, rampTargetId: "b1", rampShots: 0 }] },
    );
    both(buildFightBoard(quick));
    expect(fullTexts(fights())).toEqual(["B1 (Blue) was hit by the outer turret (top)"]);
    expect(fullTexts(away())).toEqual(["R2 (Red) is recalling, 1 second left", "R1 (Red) is dead and returns in 1 second"]);
  });

  it("says quiet on each strip that has nothing, and only on that one", () => {
    const { unmount } = both(busyRows().filter((row) => row.kind === "contact" || row.kind === "turret"));
    expect(within(away()).getByText("Nobody is recalling or waiting to return")).toBeInTheDocument();
    expect(within(fights()).queryByText("Nobody is fighting")).toBeNull();
    unmount();
    both(buildFightBoard(moment([champ("b1", "blue")])));
    expect(within(fights()).getByText("Nobody is fighting")).toBeInTheDocument();
    expect(within(away()).getByText("Nobody is recalling or waiting to return")).toBeInTheDocument();
  });
});

describe("the strips as the map's text twin", () => {
  it("are always on show: sections with a heading and a list, not a closed details", () => {
    both(busyRows());
    for (const strip of [fights(), away()]) {
      expect(strip.tagName).toBe("SECTION");
      expect(strip.querySelector("details, summary")).toBeNull();
    }
    expect(within(fights()).getByRole("heading", { name: "Fight board" })).toBeInTheDocument();
    expect(within(away()).getByRole("heading", { name: "Away" })).toBeInTheDocument();
  });

  it("do not announce: no live region, so a ticking row is never read out", () => {
    both(busyRows());
    for (const strip of [fights(), away()]) {
      expect(strip.querySelector("[role='status'], [role='alert'], [aria-live]")).toBeNull();
    }
  });

  it("are what the map's aria-describedby resolves to, every row of both", () => {
    render(
      <>
        <div role="img" aria-label="Map" aria-describedby={`${FIGHT_BOARD_ID} ${AWAY_BOARD_ID}`} />
        <FightBoard rows={busyRows()} variant="fights" />
        <FightBoard rows={busyRows()} variant="away" />
      </>,
    );
    expect(document.getElementById(FIGHT_BOARD_ID)).toBe(fights());
    expect(document.getElementById(AWAY_BOARD_ID)).toBe(away());
    const description = screen.getByRole("img", { name: "Map" }).getAttribute("aria-describedby");
    expect(description).toBe("arena-fight-board arena-away-board");
    expect(screen.getByRole("img", { name: "Map" })).toHaveAccessibleDescription(
      expect.stringMatching(/B1 \(Blue\) and R1 \(Red\) are trading hits.*B3 \(Blue\) is dead and returns in 22 seconds/),
    );
  });

  it("name their lists", () => {
    both(busyRows());
    expect(within(fights()).getByRole("list", { name: "Contacts and tower fire" })).toBeInTheDocument();
    expect(within(away()).getByRole("list", { name: "Recalls and deaths" })).toBeInTheDocument();
  });

  it("takes another id when given one", () => {
    render(<FightBoard rows={busyRows()} id="twin" />);
    expect(fights().id).toBe("twin");
  });
});

describe("rows past the visible ones", () => {
  const manyContacts = (): FightBoardRow[] =>
    ["a", "b", "c", "d"].map((id) => ({
      id: `contact:${id}`,
      kind: "contact",
      params: {
        a: { id, name: id.toUpperCase(), team: "blue" },
        b: { id: `${id}2`, name: `${id.toUpperCase()}2`, team: "red" },
        mutual: true,
        hits: [],
        ageSec: 1,
      },
    }));

  it(`draws ${VISIBLE_ROWS} rows, marks the rest as clipped and counts them, keeping every sentence on the page`, () => {
    render(<FightBoard rows={manyContacts()} />);
    const rows = rowsOf(fights());
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.hasAttribute("data-extra"))).toEqual([false, false, true, true]);
    expect(within(fights()).getByText("+2")).toHaveAttribute("aria-hidden", "true");
    expect(fullTexts(fights())).toHaveLength(4);
    expect(fullTexts(fights()).every((text) => text && /trading hits/.test(text))).toBe(true);
  });

  it("shows no count when everything is visible", () => {
    render(<FightBoard rows={manyContacts().slice(0, 2)} />);
    expect(fights().querySelector(".arena-board-more")).toBeNull();
  });
});

describe("rows across commits", () => {
  const contact = (ageSec: number): FightBoardRow => ({
    id: "contact:a|b",
    kind: "contact",
    params: {
      a: { id: "a", name: "A", team: "blue" },
      b: { id: "b", name: "B", team: "red" },
      mutual: false,
      hits: [{ attacker: { id: "a", name: "A", team: "blue" }, victim: { id: "b", name: "B", team: "red" }, ageSec }],
      ageSec,
    },
  });
  const recall: FightBoardRow = {
    id: "recall:c",
    kind: "recall",
    params: { champion: { id: "c", name: "C", team: "red" }, secondsLeft: 3, totalSec: 6.5 },
  };

  it("keeps the element of a row whose id lasts, even when rows come in front of it or text changes", () => {
    const { rerender } = render(<FightBoard rows={[contact(1)]} />);
    const before = rowsOf(fights())[0];
    rerender(<FightBoard rows={[recall, contact(2.4)]} />);
    const after = rowsOf(fights()).find((row) => row.dataset.rowId === "contact:a|b");
    expect(after).toBe(before);
    expect(after).toHaveTextContent("last hit 2 seconds ago");
  });

  it("drops a row when its thing ends", () => {
    const { rerender } = render(<FightBoard rows={[contact(1)]} />);
    expect(rowsOf(fights())).toHaveLength(1);
    rerender(<FightBoard rows={[recall]} />);
    expect(rowsOf(fights())).toHaveLength(0);
  });
});

describe("in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish with the team in words and shows no raw key", () => {
    const { container } = both(busyRows());
    expect(within(fights()).getByRole("heading", { name: "Tablero de combate" })).toBeInTheDocument();
    expect(fullTexts(fights())[0]).toBe("B1 (Azul) y R1 (Rojo) se golpean entre sí, último golpe hace 1 segundo");
    expect(fullTexts(fights())[2]).toBe("R1 (Rojo) está bajo el fuego de la torre exterior (superior), 3 impactos seguidos");
    expect(fullTexts(away())[0]).toBe("R3 (Rojo) está volviendo a la base, quedan 4 segundos");
    expect(fullTexts(away())[1]).toBe("B3 (Azul) cayó y vuelve en 22 segundos");
    expect(shortTexts(fights())[0]).toBe("B1 contra R1");
    expect(container.textContent).not.toMatch(/onAir\.match\./);
  });
});
