import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { buildFightBoard, type FightBoardRow } from "@/lib/match/live/fightBoard";

import { NOW, TOWER_ON_R1, busyMoment, champ, moment } from "./engagementFixtures.testing";
import { FIGHT_BOARD_ID, FightBoard } from "./FightBoard";

const board = () => screen.getByTestId("fight-board") as HTMLDetailsElement;
const rows = () => within(board()).getAllByRole("listitem");
const rowTexts = () => rows().map((row) => row.textContent);

const busyRows = () => buildFightBoard(busyMoment());

describe("what the board says", () => {
  it("writes one row per contact, tower, recall and death, naming the team in words", () => {
    render(<FightBoard rows={busyRows()} />);
    expect(rowTexts()).toEqual([
      "FightingB1 (Blue) and R1 (Red) are trading hits, last hit 1 second ago",
      "FightingB2 (Blue) is hitting R2 (Red), last hit 2 seconds ago",
      "TowerR1 (Red) is under fire from the outer turret (top), 3 hits in a row",
      "RecallR3 (Red) is recalling, 4 seconds left",
      "DeadB3 (Blue) is dead and returns in 22 seconds",
    ]);
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
    render(<FightBoard rows={buildFightBoard(quick)} />);
    expect(rowTexts()).toEqual([
      "TowerB1 (Blue) was hit by the outer turret (top)",
      "RecallR2 (Red) is recalling, 1 second left",
      "DeadR1 (Red) is dead and returns in 1 second",
    ]);
  });

  it("counts what is active in the summary, and says quiet when nothing is", () => {
    const { rerender } = render(<FightBoard rows={busyRows()} />);
    expect(board().querySelector("summary")).toHaveTextContent("Fight board5 active");
    rerender(<FightBoard rows={buildFightBoard(moment([champ("b1", "blue")]))} />);
    expect(board().querySelector("summary")).toHaveTextContent("Fight boardQuiet");
    expect(rowTexts()).toEqual(["QuietNobody is fighting, recalling or waiting to return"]);
  });
});

describe("the board as the map's text twin", () => {
  it("is a native details, closed by default, whose rows stay in the DOM", () => {
    render(<FightBoard rows={busyRows()} />);
    expect(board().tagName).toBe("DETAILS");
    expect(board().open).toBe(false);
    expect(rows()).toHaveLength(5);
    expect(board().querySelector("summary")).not.toHaveAttribute("tabindex");
  });

  it("is what an element's aria-describedby resolves to while it is closed", () => {
    render(
      <>
        <div role="img" aria-label="Map" aria-describedby={FIGHT_BOARD_ID} />
        <FightBoard rows={busyRows()} />
      </>,
    );
    expect(document.getElementById(FIGHT_BOARD_ID)).toBe(board());
    expect(screen.getByRole("img", { name: "Map" })).toHaveAccessibleDescription(
      expect.stringContaining("B1 (Blue) and R1 (Red) are trading hits"),
    );
  });

  it("takes another id when given one", () => {
    render(<FightBoard rows={busyRows()} id="twin" />);
    expect(board().id).toBe("twin");
  });

  it("opens and closes from its summary, which is what Enter and Space press in a browser", () => {
    render(<FightBoard rows={busyRows()} />);
    const summary = board().querySelector("summary") as HTMLElement;
    fireEvent.click(summary);
    expect(board().open).toBe(true);
    fireEvent.click(summary);
    expect(board().open).toBe(false);
  });

  it("stays open while the rows change", () => {
    const { rerender } = render(<FightBoard rows={busyRows()} />);
    fireEvent.click(board().querySelector("summary") as HTMLElement);
    rerender(<FightBoard rows={buildFightBoard(moment([champ("b1", "blue", { alive: false, respawnAt: NOW + 5 })]))} />);
    expect(board().open).toBe(true);
  });

  it("names its list for a screen reader", () => {
    render(<FightBoard rows={busyRows()} />);
    expect(within(board()).getByRole("list", { name: "Contacts, tower fire, recalls and deaths" })).toBeInTheDocument();
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
    const before = rows()[0];
    rerender(<FightBoard rows={[recall, contact(2.4)]} />);
    const after = rows().find((row) => row.dataset.rowId === "contact:a|b");
    expect(after).toBe(before);
    expect(after).toHaveTextContent("last hit 2 seconds ago");
  });

  it("drops a row when its thing ends", () => {
    const { rerender } = render(<FightBoard rows={[contact(1), recall]} />);
    rerender(<FightBoard rows={[recall]} />);
    expect(rows().map((row) => row.dataset.rowId)).toEqual(["recall:c"]);
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
    const { container } = render(<FightBoard rows={busyRows()} />);
    expect(board().querySelector("summary")).toHaveTextContent("Tablero de combate5 activos");
    expect(rowTexts()[0]).toBe("PeleandoB1 (Azul) y R1 (Rojo) se golpean entre sí, último golpe hace 1 segundo");
    expect(rowTexts()[2]).toBe("TorreR1 (Rojo) está bajo el fuego de la torre exterior (superior), 3 impactos seguidos");
    expect(rowTexts()[3]).toBe("RegresoR3 (Rojo) está volviendo a la base, quedan 4 segundos");
    expect(rowTexts()[4]).toBe("CaídoB3 (Azul) cayó y vuelve en 22 segundos");
    expect(container.textContent).not.toMatch(/onAir\.match\./);
  });
});
