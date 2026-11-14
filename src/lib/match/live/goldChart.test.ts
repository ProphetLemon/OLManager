import { describe, expect, it } from "vitest";

import { goldChartModel, goldSummary, leadOf, niceStep } from "./goldChart";
import type { GoldSample } from "./matchRecord";

const at = (minute: number, diff: number, timeSec = minute * 60): GoldSample => ({ minute, timeSec, diff, players: {} });

describe("niceStep", () => {
  it("picks a round step that keeps the axis to a handful of lines", () => {
    expect(niceStep(150)).toBe(500);
    expect(niceStep(1800)).toBe(500);
    expect(niceStep(7100)).toBe(2000);
    expect(niceStep(26000)).toBe(10000);
  });
});

describe("goldChartModel: scale", () => {
  const series = [at(0, 0), at(10, 2100), at(20, 7140), at(30, -1500), at(31, 8200, 1908)];
  const model = goldChartModel(series, 1908)!;

  it("gives the zero line a place between the two ends and rounds both ends to a step", () => {
    expect(model.yMax).toBe(10000);
    expect(model.yMin).toBe(-2000);
    expect(model.ticks.map((tick) => tick.value)).toEqual([10000, 8000, 6000, 4000, 2000, 0, -2000]);
    expect(model.zeroTop).toBeCloseTo(10000 / 12000, 6);
  });

  it("places each sample by its real time and value", () => {
    expect(model.points[0]).toMatchObject({ timeSec: 0, x: 0 });
    expect(model.points[4].x).toBe(1);
    expect(model.points[1].x).toBeCloseTo(600 / 1908, 6);
    expect(model.points[1].y).toBeCloseTo((10000 - 2100) / 12000, 6);
  });

  it("keeps at least one step on both sides of zero when one team led the whole match", () => {
    const oneSided = goldChartModel([at(0, 0), at(5, 300), at(10, 900)], 600)!;
    expect(oneSided.yMin).toBe(-500);
    expect(oneSided.yMax).toBe(1000);
  });

  it("is nothing to draw with fewer than two samples", () => {
    expect(goldChartModel([at(0, 0)], 600)).toBeNull();
    expect(goldChartModel([], 600)).toBeNull();
  });
});

describe("goldChartModel: lines and areas", () => {
  it("draws one line through a series seen minute by minute, and tints each side of zero where it is", () => {
    const model = goldChartModel([at(0, 0), at(1, 1000), at(2, -1000), at(3, -500)], 180)!;
    expect(model.runs).toHaveLength(1);
    const [run] = model.runs;
    expect(run.line.startsWith("M0.0 ")).toBe(true);
    expect(run.line.match(/L/g)).toHaveLength(3);
    // The line crosses zero between minute 1 and 2: both areas get the crossing point, at its real time.
    expect(run.areaPos).toContain("L500.0");
    expect(run.areaNeg).toContain("L500.0");
    expect(run.areaPos.endsWith("Z")).toBe(true);
  });

  it("flattens the area of the side that is not ahead onto the zero line", () => {
    const model = goldChartModel([at(0, 0), at(1, 2000), at(2, 3000)], 120)!;
    const zero = (model.zeroTop * 1000).toFixed(1);
    const heights = [...model.runs[0].areaNeg.matchAll(/L[\d.]+ ([\d.]+)/g)].map((m) => m[1]);
    expect(heights.every((h) => h === zero)).toBe(true);
  });

  it("breaks the line where a skip left minutes nobody saw, and marks the gap, instead of bridging it", () => {
    const model = goldChartModel([at(0, 0), at(1, 500), at(2, 800), at(25, 5000), at(26, 5200, 1580)], 1580)!;
    expect(model.runs).toHaveLength(2);
    expect(model.runs[0].line.match(/L/g)).toHaveLength(2);
    expect(model.runs[1].line.match(/L/g)).toHaveLength(1);
    expect(model.gaps).toEqual([{ fromSec: 120, toSec: 1500, left: 120 / 1580, width: (1500 - 120) / 1580 }]);
  });

  it("keeps a lone sample between two gaps as a dot, not a line", () => {
    const model = goldChartModel([at(0, 0), at(1, 100), at(10, 900), at(20, 2000), at(21, 2100)], 1260)!;
    expect(model.runs).toHaveLength(2);
    expect(model.isolated.map((point) => point.timeSec)).toEqual([600]);
  });
});

describe("leadOf and goldSummary", () => {
  it("names the side ahead, with the size of the lead", () => {
    expect(leadOf(at(5, 1200))).toEqual({ side: "blue", amount: 1200 });
    expect(leadOf(at(5, -300))).toEqual({ side: "red", amount: 300 });
    expect(leadOf(at(5, 0))).toEqual({ side: null, amount: 0 });
  });

  const series = [at(0, 0), at(1, -150), at(10, 2100), at(18, 7140, 1081), at(25, 5100), at(31, 8200, 1908)];

  it("tells the end, each side's biggest lead and when the match was last level", () => {
    expect(goldSummary(series, [])).toEqual({
      final: { side: "blue", amount: 8200, timeSec: 1908 },
      peakBlue: { side: "blue", amount: 8200, timeSec: 1908 },
      peakRed: { side: "red", amount: 150, timeSec: 60 },
      partial: false,
      gaps: [],
    });
  });

  it("carries the gaps, so the text alternative can say the series is partial", () => {
    const gaps = [{ fromSec: 60, toSec: 600, fromMinute: 1, toMinute: 10 }];
    expect(goldSummary(series, gaps)).toMatchObject({ partial: true, gaps });
  });

  it("has no peak for a side that never led", () => {
    expect(goldSummary([at(0, 0), at(5, 500)], []).peakRed).toBeNull();
  });
});
