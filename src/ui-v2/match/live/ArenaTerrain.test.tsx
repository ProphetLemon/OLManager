import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArenaTerrain } from "@/ui-v2/match/live/ArenaTerrain";
import { RIFT_IMAGE_SRC } from "@/ui-v2/match/live/riftImage";
import { MAP_UNITS } from "@/lib/match/live/mapGeometry";

const draw = () => render(<ArenaTerrain />).container;

describe("ArenaTerrain", () => {
  it("is hidden from assistive technology and not focusable", () => {
    const svg = draw().querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", `0 0 ${MAP_UNITS} ${MAP_UNITS}`);
  });

  it("draws the Rift image across the whole map, over the terrain ground", () => {
    const container = draw();
    const image = container.querySelector("image")!;
    expect(RIFT_IMAGE_SRC).toBe("/map.webp");
    expect(image).toHaveAttribute("href", RIFT_IMAGE_SRC);
    expect(image).toHaveAttribute("x", "0");
    expect(image).toHaveAttribute("y", "0");
    expect(image).toHaveAttribute("width", String(MAP_UNITS));
    expect(image).toHaveAttribute("height", String(MAP_UNITS));
    expect(container.querySelector("rect")).toHaveStyle({ fill: "var(--terrain-ground)" });
  });

  it("keeps the picture in full colour: no filter, no dimming, no direction switch", () => {
    const container = draw();
    const image = container.querySelector("image")!;
    expect(container.querySelector("filter")).toBeNull();
    expect(image).not.toHaveAttribute("filter");
    expect(image).not.toHaveAttribute("opacity");
    expect(container.querySelector("svg")).not.toHaveAttribute("data-direction");
  });

  it("draws nothing but the ground and the picture (no vector schematic)", () => {
    const container = draw();
    expect(Array.from(container.querySelector("svg")!.children).map((node) => node.tagName.toLowerCase())).toEqual([
      "rect",
      "image",
    ]);
  });

  it("paints with tokens only", () => {
    expect(draw().innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
