import { describe, expect, it } from "vitest";
import { chipPosition, linkDots, linkEndpoints, linkOpacity } from "@/lib/match/live/linkGeometry";
import type { ContactPair } from "@/lib/match/live/contacts";

/** Bubble radius as the marker CSS sizes it: clamp(24px, 4.8cqw, 38px) across. */
const bubbleRadiusPx = (sizePx: number) => Math.min(38, Math.max(24, sizePx * 0.048)) / 2;

const toPx = (units: number, sizePx: number) => (units * sizePx) / 1000;

describe("linkEndpoints", () => {
  it.each([540, 660])("keeps both ends outside both bubbles for the top lane pair 0.062 apart at %i px", (size) => {
    const a = { x: 0.1, y: 0.4 };
    const b = { x: 0.1, y: 0.462 }; // 0.062 apart
    const r = bubbleRadiusPx(size);
    const e = linkEndpoints(a, b, r, size);

    expect(e.visible).toBe(true);
    const fromA = Math.hypot(toPx(e.x1 - a.x * 1000, size), toPx(e.y1 - a.y * 1000, size));
    const fromB = Math.hypot(toPx(e.x2 - b.x * 1000, size), toPx(e.y2 - b.y * 1000, size));
    expect(fromA).toBeGreaterThanOrEqual(r);
    expect(fromB).toBeGreaterThanOrEqual(r);
    // The heads do not cross: the link still runs from a towards b.
    expect((e.x2 - e.x1) * (b.x - a.x) + (e.y2 - e.y1) * (b.y - a.y)).toBeGreaterThan(0);
    expect(e.lengthUnits).toBeGreaterThan(0);
  });

  it("works along any direction, not only vertically", () => {
    const a = { x: 0.3, y: 0.3 };
    const b = { x: 0.36, y: 0.34 };
    const size = 660;
    const r = bubbleRadiusPx(size);
    const e = linkEndpoints(a, b, r, size);
    expect(e.visible).toBe(true);
    expect(Math.hypot(toPx(e.x1 - 300, size), toPx(e.y1 - 300, size))).toBeCloseTo(r + 1.5, 5);
    expect(Math.hypot(toPx(e.x2 - 360, size), toPx(e.y2 - 340, size))).toBeCloseTo(r + 1.5, 5);
  });

  it("hides the link when the bubbles touch or overlap, and sits at the midpoint", () => {
    const size = 320;
    const r = bubbleRadiusPx(size);
    const e = linkEndpoints({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 + 0.03 }, r, size);
    expect(e.visible).toBe(false);
    expect(e.lengthUnits).toBe(0);
    expect(e.x1).toBe(e.x2);
    expect(e.y1).toBe(e.y2);
  });

  it("does not divide by zero for the same point or a map with no size", () => {
    expect(linkEndpoints({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 12, 540).visible).toBe(false);
    const empty = linkEndpoints({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 12, 0);
    expect(empty.visible).toBe(false);
    expect(Number.isFinite(empty.x1)).toBe(true);
  });

  it("takes a different radius for the second end (a tower beam ends on a champion)", () => {
    const size = 540;
    const e = linkEndpoints({ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }, 14, size, { radiusBPx: 20 });
    expect(toPx(e.x1 - 200, size)).toBeCloseTo(15.5, 5);
    expect(toPx(600 - e.x2, size)).toBeCloseTo(21.5, 5);
  });
});

describe("linkDots", () => {
  const pair = (ageByTarget: ContactPair["ageByTarget"]): Pick<ContactPair, "a" | "b" | "ageByTarget"> => ({
    a: "b1",
    b: "r1",
    ageByTarget,
  });

  it("puts the dot on the attacker: a hit on b means a attacked", () => {
    expect(linkDots(pair({ r1: 1 }))).toEqual({ atA: true, atB: false });
    expect(linkDots(pair({ b1: 1 }))).toEqual({ atA: false, atB: true });
  });

  it("puts a dot at both ends when both hit", () => {
    expect(linkDots(pair({ b1: 1, r1: 2 }))).toEqual({ atA: true, atB: true });
  });
});

describe("chipPosition and linkOpacity", () => {
  it("puts the chip at the midpoint", () => {
    expect(chipPosition({ x: 0.2, y: 0.4 }, { x: 0.4, y: 0.8 })).toEqual({ x: 0.30000000000000004, y: 0.6000000000000001 });
  });

  it("fades by age: 1, then 0.78, then 0.55", () => {
    expect(linkOpacity(0)).toBe(1);
    expect(linkOpacity(1.4)).toBe(1);
    expect(linkOpacity(1.5)).toBe(0.78);
    expect(linkOpacity(2.9)).toBe(0.78);
    expect(linkOpacity(3)).toBe(0.55);
  });
});
