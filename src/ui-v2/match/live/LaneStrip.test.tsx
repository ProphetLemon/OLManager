import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { LaneView } from "@/lib/match/live/laneStrip";
import { teamIdentity } from "@/lib/match/live/teamIdentity";

import { LaneStrip } from "./LaneStrip";

const BLUE = { ...teamIdentity("Emberfall", [{ name: "Emberfall", short_name: "EMB" }]), logoUrl: "/logos/emb.webp" };
const RED = teamIdentity("Tidal Lanterns", [{ name: "Tidal Lanterns", short_name: "TDL" }]);

const lane = (name: LaneView["lane"], push: LaneView["push"], front: number | null, fight = false): LaneView => ({ lane: name, push, front, fight });
const LANES: LaneView[] = [lane("top", "blue", 0.7), lane("mid", "even", 0.5, true), lane("bot", "none", null)];

const cell = (name: RegExp) => screen.getByRole("img", { name });

describe("the lane strip", () => {
  it("is a group of three cells, top, mid and bot, each one image with a sentence for its label", () => {
    render(<LaneStrip lanes={LANES} blue={BLUE} red={RED} />);
    const strip = screen.getByTestId("lane-strip");
    expect(strip).toHaveAttribute("role", "group");
    expect(strip).toHaveAccessibleName("Lanes");
    expect(within(strip).getAllByRole("img").map((el) => el.getAttribute("aria-label"))).toEqual([
      "Top lane: Emberfall is pushing toward the Red base.",
      "Mid lane: the waves are even, and a fight is on.",
      "Bot lane: no wave on the lane.",
    ]);
  });

  it("says which way the wave pushes with arrows and words, not colour: toward the red base for blue and back for red", () => {
    const { rerender } = render(<LaneStrip lanes={[lane("top", "blue", 0.7)]} blue={BLUE} red={RED} />);
    expect(cell(/Top lane/).querySelector(".arena-lane-mark svg")).toHaveClass("lucide-chevrons-right");
    expect(cell(/Top lane/)).toHaveTextContent("EMB pushes");
    rerender(<LaneStrip lanes={[lane("top", "red", 0.3)]} blue={BLUE} red={RED} />);
    expect(cell(/Top lane/).querySelector(".arena-lane-mark svg")).toHaveClass("lucide-chevrons-left");
    expect(cell(/Top lane/)).toHaveTextContent("TDL pushes");
    expect(cell(/Top lane/)).toHaveAccessibleName("Top lane: Tidal Lanterns is pushing toward the Blue base.");
    rerender(<LaneStrip lanes={[lane("top", "even", 0.5)]} blue={BLUE} red={RED} />);
    expect(cell(/Top lane/).querySelector(".arena-lane-mark svg")).toHaveClass("lucide-equal");
    expect(cell(/Top lane/)).toHaveTextContent("Even");
  });

  it("draws the meeting point along the track, and no mark when there is no wave", () => {
    render(<LaneStrip lanes={LANES} blue={BLUE} red={RED} />);
    expect((cell(/Top lane/).querySelector(".arena-lane-mark") as HTMLElement).style.left).toBe("64.4%");
    expect((cell(/Mid lane/).querySelector(".arena-lane-mark") as HTMLElement).style.left).toBe("50%");
    expect(cell(/Bot lane/).querySelector(".arena-lane-mark")).toBeNull();
    expect(cell(/Bot lane/)).toHaveTextContent("No wave");
  });

  it("keeps the mark on the track even for a front outside 0 to 1", () => {
    render(<LaneStrip lanes={[lane("top", "blue", 1.4)]} blue={BLUE} red={RED} />);
    expect((cell(/Top lane/).querySelector(".arena-lane-mark") as HTMLElement).style.left).toBe("86%");
  });

  it("marks a fight with the word and a frame flag, and only on the lane that has one", () => {
    render(<LaneStrip lanes={LANES} blue={BLUE} red={RED} />);
    expect(cell(/Mid lane/)).toHaveAttribute("data-fight", "true");
    expect(cell(/Mid lane/)).toHaveTextContent("Fight");
    expect(cell(/Top lane/)).not.toHaveAttribute("data-fight");
    expect(cell(/Top lane/)).not.toHaveTextContent("Fight");
  });

  it("puts the base ends of the track in as shapes: a circle for blue and a diamond for red", () => {
    render(<LaneStrip lanes={[lane("top", "none", null)]} blue={BLUE} red={RED} />);
    const ends = [...cell(/Top lane/).querySelectorAll(".arena-lane-end")].map((el) => el.getAttribute("data-team"));
    expect(ends).toEqual(["blue", "red"]);
  });

  it("shows the pushing club's logo when it has one, decoratively", () => {
    render(<LaneStrip lanes={[lane("top", "blue", 0.7), lane("mid", "red", 0.3)]} blue={BLUE} red={RED} />);
    const logo = cell(/Top lane/).querySelector("img");
    expect(logo).toHaveAttribute("src", "/logos/emb.webp");
    expect(logo).toHaveAttribute("alt", "");
    expect(cell(/Mid lane/).querySelector("img")).toBeNull();
  });

  it("is not a live region", () => {
    render(<LaneStrip lanes={LANES} blue={BLUE} red={RED} />);
    expect(screen.getByTestId("lane-strip").querySelector("[aria-live], [role='status']")).toBeNull();
  });
});

describe("the lane strip in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish and shows no raw key", () => {
    const { container } = render(<LaneStrip lanes={LANES} blue={BLUE} red={RED} />);
    expect(screen.getByTestId("lane-strip")).toHaveAccessibleName("Calles");
    expect(cell(/Calle Arriba/)).toHaveAccessibleName("Calle Arriba: Emberfall empuja hacia la base Rojo.");
    expect(cell(/Calle Centro/)).toHaveTextContent("Pelea");
    expect(container.textContent).not.toMatch(/onAir\.match\./);
  });
});
