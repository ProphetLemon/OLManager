import { describe, expect, it } from "vitest";
import {
  decideRailMode,
  navCell,
  navRow,
  RAIL_CLUSTER_CELLS,
  RAIL_CLUSTER_COLUMNS,
  RAIL_STRUCTURAL_PARTS,
  RAIL_STRUCTURAL_PX,
  railClusterHeight,
  splitLabelsFit,
  splitNeed,
  navRowChild,
  railNeed,
  railWTree,
  type RailMode,
} from "./railMode";

const TITLE_BAR_REM = 2.25;
const SCALES = [
  ["XS", 12],
  ["S", 14],
  ["M", 16],
  ["L", 18],
  ["XL", 20],
] as const;

function modeFor(w: number, h: number, rootPx: number, current: RailMode = "tree") {
  return decideRailMode({
    platform: "desktop",
    slotW: w,
    slotH: h - TITLE_BAR_REM * rootPx,
    rootPx,
    current,
  });
}

describe("size helpers", () => {
  it("hold their px floors at small roots and scale with the root above", () => {
    expect([12, 16, 18, 20].map(navRow)).toEqual([32, 32, 36, 40]);
    expect([12, 16, 18, 20].map(navRowChild)).toEqual([28, 28, 31.5, 35]);
    expect([12, 16, 18, 20].map(navCell)).toEqual([36, 36, 40.5, 45]);
    expect([12, 16, 18, 20].map(railWTree)).toEqual([192, 224, 252, 280]);
  });

  it("derive the height the tree needs (spec section 3 thresholds)", () => {
    expect([12, 14, 16, 18, 20].map((r) => railNeed(r))).toEqual([622, 622, 622, 693.5, 765]);
    expect(railNeed(16, 50)).toBe(672);
  });
});

describe("the utility cluster", () => {
  it("is four cells in one row of the grid", () => {
    expect(RAIL_CLUSTER_CELLS).toBe(4);
    expect(RAIL_CLUSTER_COLUMNS).toBe(4);
  });

  it("is one --nav-cell high at every root, and need is built from that same helper", () => {
    for (const r of [9, 12, 14, 16, 18, 20]) {
      expect(railClusterHeight(r)).toBe(navCell(r));
      expect(railNeed(r)).toBe(
        RAIL_STRUCTURAL_PX + 8 * navRow(r) + 10 * navRowChild(r) + railClusterHeight(r),
      );
    }
  });
});

describe("the structural allowance", () => {
  it("is exactly the itemised px-fixed parts, margin included, so a growing part is caught", () => {
    const parts = Object.values(RAIL_STRUCTURAL_PARTS).reduce((a, b) => a + b, 0);
    expect(parts).toBe(RAIL_STRUCTURAL_PX);
    expect(RAIL_STRUCTURAL_PARTS.safetyMargin).toBe(8);
  });

  it("makes need at roots 18 and 20 the rows plus the constant allowance (the rows are the only rem part)", () => {
    expect(railNeed(18)).toBe(RAIL_STRUCTURAL_PX + 8 * 36 + 10 * 31.5 + 40.5);
    expect(railNeed(20)).toBe(RAIL_STRUCTURAL_PX + 8 * 40 + 10 * 35 + 45);
    expect(railNeed(20)).toBe(765);
  });
});

describe("decideRailMode against the prediction table", () => {
  const expected: Record<string, RailMode[]> = {
    "1920x1080": ["tree", "tree", "tree", "tree", "tree"],
    "1280x800": ["tree", "tree", "tree", "tree", "split"],
    "960x640": ["split", "split", "split", "split", "split"],
  };

  for (const [window, modes] of Object.entries(expected)) {
    const [w, h] = window.split("x").map(Number);
    SCALES.forEach(([scale, root], i) => {
      it(`${window} at ${scale} (root ${root}) is ${modes[i]}`, () => {
        expect(modeFor(w, h, root)).toBe(modes[i]);
      });
    });
  }

  it("never lets the 960x640 window into the tree, whatever the height margin", () => {
    expect(
      decideRailMode({ platform: "desktop", slotW: 960, slotH: 5000, rootPx: 12, current: "tree" }),
    ).toBe("split");
  });
});

describe("thresholds", () => {
  const at = (slotW: number, slotH: number, rootPx: number, current: RailMode) =>
    decideRailMode({ platform: "desktop", slotW, slotH, rootPx, current });

  it("is inclusive on both floors", () => {
    expect(at(1104, 622, 16, "tree")).toBe("tree");
    expect(at(1103.9, 622, 16, "tree")).toBe("split");
    expect(at(1104, 621.9, 16, "tree")).toBe("split");
  });

  it("applies 16 px of hysteresis only when re-entering the tree from split", () => {
    expect(at(1104, 622, 16, "split")).toBe("split");
    expect(at(1119.9, 622, 16, "split")).toBe("split");
    expect(at(1120, 638, 16, "split")).toBe("tree");
    expect(at(1120, 637.9, 16, "split")).toBe("split");
    expect(at(1119.9, 638, 16, "split")).toBe("split");
  });

  it("does not apply the margin when staying in the tree", () => {
    expect(at(1104, 622, 16, "tree")).toBe("tree");
  });

  it("subtracts reservedTop from the height budget", () => {
    expect(at(1280, 660, 16, "tree")).toBe("tree");
    expect(
      decideRailMode({
        platform: "desktop",
        slotW: 1280,
        slotH: 660,
        rootPx: 16,
        current: "tree",
        reservedTop: 50,
      }),
    ).toBe("split");
  });

  it("defaults reservedTop to 0", () => {
    expect(at(1280, 622, 16, "tree")).toBe("tree");
  });
});

describe("android", () => {
  it("is always split, however large the slot", () => {
    for (const current of ["tree", "split"] as const) {
      expect(
        decideRailMode({ platform: "android", slotW: 5000, slotH: 5000, rootPx: 9, current }),
      ).toBe("split");
    }
  });
});

describe("degenerate inputs", () => {
  const base = { platform: "desktop", current: "tree" } as const;

  it("is split for a 0 x 0 slot", () => {
    expect(decideRailMode({ ...base, slotW: 0, slotH: 0, rootPx: 16 })).toBe("split");
  });

  it("is split, never tree, when the root size is NaN (every comparison is false)", () => {
    expect(decideRailMode({ ...base, slotW: 5000, slotH: 5000, rootPx: NaN })).toBe("split");
  });

  it("uses the px floors for a root of 0 or 9", () => {
    for (const rootPx of [0, 9]) {
      expect(railNeed(rootPx)).toBe(622);
      expect(railWTree(rootPx)).toBe(192);
      expect(decideRailMode({ ...base, slotW: 1072, slotH: 622, rootPx })).toBe("tree");
      expect(decideRailMode({ ...base, slotW: 1071, slotH: 622, rootPx })).toBe("split");
    }
  });
});

describe("splitLabelsFit (R13)", () => {
  const TITLE = 2.25;
  const fit = (root: number, windowH: number, lines: 1 | 2, current: "labels" | "icons" = "labels") =>
    splitLabelsFit({ slotH: windowH - TITLE * root, rootPx: root, labelLines: lines, current });

  // Window height 640 and 800 at XS, M, L and XL; slot = window minus the rem title bar.
  const table: Array<[string, number, number, "labels" | "icons", "labels" | "icons"]> = [
    // scale, root, window height, one-line labels, two-line labels
    ["XS", 12, 640, "labels", "labels"],
    ["M", 16, 640, "labels", "icons"],
    ["L", 18, 640, "icons", "icons"],
    ["XL", 20, 640, "icons", "icons"],
    ["XS", 12, 800, "labels", "labels"],
    ["M", 16, 800, "labels", "labels"],
    ["L", 18, 800, "labels", "icons"],
    ["XL", 20, 800, "labels", "icons"],
  ];
  it.each(table)("%s (root %i) at window height %i", (_s, root, h, one, two) => {
    expect(fit(root, h, 1)).toBe(one);
    expect(fit(root, h, 2)).toBe(two);
  });

  it("derives the need from the same tokens as railMode (helpers, cluster, separator)", () => {
    // M, one line: 8 stops of 50, separator 13, four stacked cells and the cluster chrome.
    expect(splitNeed(16, "labels", 1)).toBe(8 * 50 + 13 + 4 * 36 + 9);
    expect(splitNeed(20, "icons", 2)).toBe(8 * navCell(20) + 16 + 4 * navCell(20) + 9);
    expect(splitNeed(16, "labels", 2)).toBeGreaterThan(splitNeed(16, "labels", 1));
    expect(splitNeed(16, "icons", 2)).toBeLessThan(splitNeed(16, "labels", 1));
  });

  it("is inclusive at the need, and re-enters the labels only with 16 px to spare", () => {
    const need = splitNeed(16, "labels", 1);
    const at = (slotH: number, current: "labels" | "icons") =>
      splitLabelsFit({ slotH, rootPx: 16, labelLines: 1, current });
    expect(at(need, "labels")).toBe("labels");
    expect(at(need - 0.1, "labels")).toBe("icons");
    expect(at(need, "icons")).toBe("icons");
    expect(at(need + 15.9, "icons")).toBe("icons");
    expect(at(need + 16, "icons")).toBe("labels");
  });

  it("counts a shorter list when a group is hidden", () => {
    expect(splitNeed(16, "labels", 1, 7)).toBe(splitNeed(16, "labels", 1) - 50);
  });

  it("defaults to labels, and a NaN root never claims the labels fit", () => {
    expect(splitLabelsFit({ slotH: 5000, rootPx: 16, labelLines: 1 })).toBe("labels");
    expect(splitLabelsFit({ slotH: 5000, rootPx: NaN, labelLines: 1 })).toBe("icons");
  });
});
