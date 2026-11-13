import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArenaTerrain } from "@/ui-v2/match/live/ArenaTerrain";
import {
  RIFT_IMAGE_SRC,
  TERRAIN_DIRECTION,
  TERRAIN_DIRECTIONS,
  type TerrainDirection,
} from "@/ui-v2/match/live/terrainDirection";
import { MAP_UNITS } from "@/lib/match/live/mapGeometry";

const draw = (direction?: TerrainDirection) => {
  const { container } = render(<ArenaTerrain direction={direction} />);
  return container;
};

describe("ArenaTerrain", () => {
  it("is hidden from assistive technology and not focusable", () => {
    const svg = draw().querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", `0 0 ${MAP_UNITS} ${MAP_UNITS}`);
  });

  it.each(TERRAIN_DIRECTIONS)("draws the Rift image across the whole map in the %s direction", (direction) => {
    const image = draw(direction).querySelector("image")!;
    expect(image).toHaveAttribute("href", RIFT_IMAGE_SRC);
    expect(RIFT_IMAGE_SRC).toBe("/map.webp");
    expect(image).toHaveAttribute("x", "0");
    expect(image).toHaveAttribute("y", "0");
    expect(image).toHaveAttribute("width", String(MAP_UNITS));
    expect(image).toHaveAttribute("height", String(MAP_UNITS));
  });

  it("uses the direction constant when none is given", () => {
    expect(TERRAIN_DIRECTIONS).toContain(TERRAIN_DIRECTION);
    expect(draw().querySelector("svg")).toHaveAttribute("data-direction", TERRAIN_DIRECTION);
  });

  it("original: shows the image as it is, with no filter", () => {
    const container = draw("original");
    expect(container.querySelector("svg")).toHaveAttribute("data-direction", "original");
    expect(container.querySelector("image")).not.toHaveAttribute("filter");
    expect(container.querySelector("filter")).toBeNull();
  });

  it("night: dims and desaturates the image over the terrain ground", () => {
    const container = draw("night");
    const image = container.querySelector("image")!;
    const id = /^url\(#(.+)\)$/.exec(image.getAttribute("filter") ?? "")?.[1];
    expect(id).toBeTruthy();
    const filter = container.querySelector(`filter[id="${id}"]`)!;
    expect(filter.querySelector('feColorMatrix[type="saturate"]')).not.toBeNull();
    expect(Number(image.getAttribute("opacity"))).toBeGreaterThan(0);
    expect(Number(image.getAttribute("opacity"))).toBeLessThan(1);
    expect(container.querySelector("rect")).toHaveStyle({ fill: "var(--terrain-ground)" });
  });

  it("tokens: recolours walls, paths, bases and river from the terrain tokens", () => {
    const container = draw("tokens");
    const image = container.querySelector("image")!;
    const id = /^url\(#(.+)\)$/.exec(image.getAttribute("filter") ?? "")?.[1];
    expect(id).toBeTruthy();
    const filter = container.querySelector(`filter[id="${id}"]`)!;
    const floods = Array.from(filter.querySelectorAll("feFlood")).map((flood) => (flood as SVGElement).style.getPropertyValue("flood-color"));
    expect(floods).toEqual(
      expect.arrayContaining([
        "var(--terrain-wall)",
        "var(--terrain-base)",
        "var(--terrain-path)",
        "var(--terrain-river)",
        "var(--team-blue)",
        "var(--team-red)",
      ]),
    );
    // The masks read the picture: one for walkable ground, one for the pale paths, one for the water.
    expect(filter.querySelectorAll("feColorMatrix[type='matrix']").length).toBeGreaterThanOrEqual(3);
  });

  it("tokens: tints each base with its team, in its own corner", () => {
    const filter = draw("tokens").querySelector("filter")!;
    const flood = (token: string) =>
      Array.from(filter.querySelectorAll("feFlood")).find(
        (node) => (node as SVGElement).style.getPropertyValue("flood-color") === token,
      )!;
    // Blue base: bottom left quarter. Red base: top right quarter.
    expect([flood("var(--team-blue)").getAttribute("x"), flood("var(--team-blue)").getAttribute("y")]).toEqual(["0", String(MAP_UNITS / 2)]);
    expect([flood("var(--team-red)").getAttribute("x"), flood("var(--team-red)").getAttribute("y")]).toEqual([String(MAP_UNITS / 2), "0"]);
  });

  it.each(TERRAIN_DIRECTIONS)("no longer draws the vector schematic in the %s direction", (direction) => {
    const container = draw(direction);
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector("[data-lane]")).toBeNull();
    expect(container.querySelector("[data-pit]")).toBeNull();
    expect(container.querySelector("[data-base]")).toBeNull();
    expect(container.querySelector("path")).toBeNull();
  });

  it.each(TERRAIN_DIRECTIONS)("paints with tokens only in the %s direction", (direction) => {
    const html = draw(direction).innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
