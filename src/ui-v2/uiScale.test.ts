import { describe, expect, it } from "vitest";
import { MIN_ROOT_FONT_PX, SCALE_MAP } from "@/ui-v2/uiScale";

const ORDER = ["xsmall", "small", "normal", "large", "xlarge"];
const px = (v: string) => Number.parseFloat(v);

describe("interface scale map", () => {
  it("keeps every stored scale value", () => {
    expect(Object.keys(SCALE_MAP)).toEqual(ORDER);
  });

  it("never goes below the minimum root font size", () => {
    for (const key of ORDER) {
      expect(px(SCALE_MAP[key]), key).toBeGreaterThanOrEqual(MIN_ROOT_FONT_PX);
    }
  });

  it("increases strictly from xsmall to xlarge", () => {
    const sizes = ORDER.map((k) => px(SCALE_MAP[k]));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
  });
});
