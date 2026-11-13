import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArenaTerrain } from "@/ui-v2/match/live/ArenaTerrain";
import {
  BASE_ZONES,
  LANES,
  LANE_HALF_WIDTH_UNITS,
  LANE_KEYS,
  PITS,
  distanceToPolyline,
  isInBase,
  type MapPoint,
} from "@/lib/match/live/mapGeometry";
import { STRUCTURES_LAYOUT } from "@/lib/match/lolMapLayout";

function parsePoints(value: string | null): MapPoint[] {
  return (value ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

describe("ArenaTerrain", () => {
  it("is hidden from assistive technology and not focusable", () => {
    const { container } = render(<ArenaTerrain />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", "0 0 1000 1000");
  });

  it("draws the three lanes from the geometry", () => {
    const { container } = render(<ArenaTerrain />);
    for (const lane of LANE_KEYS) {
      const drawn = container.querySelectorAll(`polyline[data-lane="${lane}"]`);
      expect(drawn).toHaveLength(2);
      expect(parsePoints(drawn[0].getAttribute("points"))).toEqual(LANES[lane]);
    }
  });

  it("puts every engine structure on a lane that is actually drawn, or in a drawn base", () => {
    const { container } = render(<ArenaTerrain />);
    const drawnLanes = Object.fromEntries(
      LANE_KEYS.map((lane) => [
        lane,
        parsePoints(container.querySelector(`polyline[data-lane="${lane}"][data-part="edge"]`)!.getAttribute("points")),
      ]),
    );
    expect(container.querySelector('path[data-base="blue"]')).toHaveAttribute("d", BASE_ZONES.blue.path);
    expect(container.querySelector('path[data-base="red"]')).toHaveAttribute("d", BASE_ZONES.red.path);

    const offenders = STRUCTURES_LAYOUT.filter((s) => {
      const p = { x: s.x * 1000, y: s.y * 1000 };
      return s.lane === "base"
        ? !isInBase(p, s.side)
        : distanceToPolyline(p, drawnLanes[s.lane]) > LANE_HALF_WIDTH_UNITS;
    }).map((s) => s.id);
    expect(offenders).toEqual([]);
  });

  it("centres the two pits where the engine puts them", () => {
    const { container } = render(<ArenaTerrain />);
    const top = container.querySelector('circle[data-pit="top"]')!;
    const dragon = container.querySelector('circle[data-pit="dragon"]')!;
    expect(Number(top.getAttribute("cx"))).toBeCloseTo(PITS.top.x, 6);
    expect(Number(top.getAttribute("cy"))).toBeCloseTo(PITS.top.y, 6);
    expect(Number(dragon.getAttribute("cx"))).toBeCloseTo(PITS.dragon.x, 6);
    expect(Number(dragon.getAttribute("cy"))).toBeCloseTo(PITS.dragon.y, 6);
  });

  it("paints with tokens only", () => {
    const { container } = render(<ArenaTerrain />);
    const html = container.innerHTML;
    expect(html).toContain("var(--terrain-ground)");
    expect(html).toContain("var(--team-blue)");
    expect(html).toContain("var(--team-red)");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
