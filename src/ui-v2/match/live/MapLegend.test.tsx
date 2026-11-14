import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";

import { MARKER_LEGEND_KEYS } from "./ChampionMarker";
import { CONTACT_LEGEND_KEYS } from "./ContactLayer";
import { LEGEND_KEYS, MapLegend } from "./MapLegend";

const legend = () => screen.getByTestId("map-legend") as HTMLDetailsElement;
const rows = () => within(legend()).getAllByRole("listitem");
const sentences = () => rows().map((row) => row.querySelector(".arena-lg-text")?.textContent);
const rowOf = (id: string) => rows().find((row) => row.dataset.row === id) as HTMLElement;

describe("the map key", () => {
  it("is a native details, closed by default, whose rows stay in the DOM", () => {
    render(<MapLegend />);
    expect(legend().tagName).toBe("DETAILS");
    expect(legend().open).toBe(false);
    expect(legend().querySelector("summary")).toHaveTextContent("Map key");
    expect(rows().length).toBeGreaterThan(0);
    fireEvent.click(legend().querySelector("summary") as HTMLElement);
    expect(legend().open).toBe(true);
  });

  it("states every key the layers export, with the words the layers promise", () => {
    render(<MapLegend />);
    for (const key of [...Object.values(CONTACT_LEGEND_KEYS), ...Object.values(MARKER_LEGEND_KEYS)]) {
      expect(sentences(), key).toContain(i18n.t(key));
    }
  });

  it("adds the rows the layers left out: champions, structures, camps, wards, push, items and cooldowns", () => {
    render(<MapLegend />);
    for (const key of Object.values(LEGEND_KEYS)) {
      expect(sentences(), key).toContain(i18n.t(key));
    }
    expect(rowOf("structures")).toHaveTextContent("blue is round, red is a diamond");
    expect(rowOf("camp")).toHaveTextContent("jungle camp");
    expect(rowOf("ward")).toHaveTextContent("a ward, round for blue and a diamond for red");
    expect(rowOf("push")).toHaveTextContent("that team is pushing it");
  });

  it("gives every row text, and keeps every picture out of the accessibility tree", () => {
    render(<MapLegend />);
    for (const row of rows()) {
      expect(row.querySelector(".arena-lg-text")?.textContent?.trim().length, row.dataset.row).toBeGreaterThan(8);
      const glyph = row.querySelector(".arena-lg-glyph");
      if (glyph) expect(glyph).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("draws a team shape for each team, so the teams are never told apart by colour alone", () => {
    render(<MapLegend />);
    for (const id of ["champions", "structures", "ward"]) {
      const teams = [...rowOf(id).querySelectorAll(".arena-lg-shape")].map((shape) => shape.getAttribute("data-team"));
      expect(teams, id).toEqual(["blue", "red"]);
    }
  });
});

describe("the key as an icon button", () => {
  it("keeps its name in a label the narrow row clips, and has an icon and a title, so it stays a named button", () => {
    render(<MapLegend />);
    const summary = legend().querySelector("summary") as HTMLElement;
    expect(summary.querySelector(".arena-btn-label")).toHaveTextContent("Map key");
    expect(summary.querySelector("svg.arena-btn-icon")).toHaveAttribute("aria-hidden", "true");
    expect(summary).toHaveAttribute("title", "Map key");
    expect(summary).toHaveAccessibleName("Map key");
  });

  it("explains the lane strip and the timer rail", () => {
    render(<MapLegend />);
    expect(rowOf("lanes")).toHaveTextContent("Strip above the map");
    expect(rowOf("timers")).toHaveTextContent("Left column under the players");
  });
});

describe("the map key in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish and shows no raw key", () => {
    const { container } = render(<MapLegend />);
    expect(legend().querySelector("summary")).toHaveTextContent("Leyenda del mapa");
    expect(rowOf("camp")).toHaveTextContent("campamento de la jungla");
    expect(rowOf("fighting")).toHaveTextContent("Anillo doble");
    expect(container.textContent).not.toMatch(/onAir\.match\./);
  });
});
