import { describe, expect, it } from "vitest";

import { createRecordingContext } from "./canvasContext.testing";
import { drawMinions, minionDiameterPx, type MinionLike } from "./drawMinions";

const COLORS = { blue: "blue-token", red: "red-token" };
const SIZE = 500;

const minion = (team: string, x: number, y: number, over: Partial<MinionLike> = {}): MinionLike => ({
  team,
  pos: { x, y },
  alive: true,
  kind: "melee",
  ...over,
});

describe("drawMinions", () => {
  it("clears the map once, then draws one shape per minion", () => {
    const recorder = createRecordingContext();
    const drawn = drawMinions(
      recorder.context,
      [minion("blue", 0.2, 0.8), minion("blue", 0.25, 0.75), minion("red", 0.7, 0.3)],
      SIZE,
      COLORS,
    );
    expect(drawn).toBe(3);
    expect(recorder.named("clearRect")).toEqual([["clearRect", 0, 0, SIZE, SIZE]]);
    expect(recorder.named("arc")).toHaveLength(2);
    expect(recorder.named("fillRect")).toHaveLength(1);
  });

  it("draws blue as a circle and red as a square, each in its team colour", () => {
    const recorder = createRecordingContext();
    drawMinions(recorder.context, [minion("blue", 0.5, 0.5), minion("red", 0.4, 0.4)], SIZE, COLORS);
    const radius = minionDiameterPx(SIZE) / 2;
    expect(recorder.named("arc")).toEqual([["arc", COLORS.blue, 250, 250, radius, 0, Math.PI * 2]]);
    expect(recorder.named("fill")).toEqual([["fill", COLORS.blue]]);
    expect(recorder.named("fillRect")).toEqual([
      ["fillRect", COLORS.red, 200 - radius, 200 - radius, radius * 2, radius * 2],
    ]);
  });

  it("leaves summons out", () => {
    const recorder = createRecordingContext();
    const drawn = drawMinions(
      recorder.context,
      [minion("blue", 0.3, 0.3), minion("blue", 0.4, 0.4, { kind: "summon" }), minion("red", 0.6, 0.6, { kind: "summon" })],
      SIZE,
      COLORS,
    );
    expect(drawn).toBe(1);
    expect(recorder.named("arc")).toHaveLength(1);
    expect(recorder.named("fillRect")).toHaveLength(0);
  });

  it("leaves dead minions out", () => {
    const recorder = createRecordingContext();
    expect(drawMinions(recorder.context, [minion("red", 0.3, 0.3, { alive: false })], SIZE, COLORS)).toBe(0);
    expect(recorder.named("fillRect")).toHaveLength(0);
  });

  it("still clears the map when there is nothing to draw", () => {
    const recorder = createRecordingContext();
    expect(drawMinions(recorder.context, [], SIZE, COLORS)).toBe(0);
    expect(recorder.calls).toEqual([["clearRect", 0, 0, SIZE, SIZE]]);
  });

  it("sizes a minion with the map, between 4 and 8 pixels", () => {
    expect(minionDiameterPx(320)).toBe(4);
    expect(minionDiameterPx(540)).toBeCloseTo(4.59);
    expect(minionDiameterPx(2000)).toBe(8);
  });
});
