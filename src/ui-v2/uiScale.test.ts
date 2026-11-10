import { describe, expect, it } from "vitest";
import {
  ANDROID_ROOT_FONT,
  MIN_OFFERED_ROOT_FONT_PX,
  SCALE_MAP,
  rootFontSizeFor,
} from "@/ui-v2/uiScale";

const ORDER = ["xsmall", "small", "normal", "large", "xlarge"];
const px = (v: string) => Number.parseFloat(v);
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";

describe("interface scale map", () => {
  it("keeps every stored scale value", () => {
    expect(Object.keys(SCALE_MAP)).toEqual(ORDER);
  });

  it("never offers a scale below the minimum root font size", () => {
    for (const key of ORDER) {
      expect(px(SCALE_MAP[key]), key).toBeGreaterThanOrEqual(MIN_OFFERED_ROOT_FONT_PX);
    }
  });

  it("increases strictly from xsmall to xlarge", () => {
    const sizes = ORDER.map((k) => px(SCALE_MAP[k]));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
  });
});

describe("root font size per platform", () => {
  it("gives desktop xsmall a 12px root", () => {
    expect(rootFontSizeFor("xsmall", DESKTOP)).toBe("12px");
  });

  it("keeps the Android root at 9px, also for a stored xsmall", () => {
    expect(ANDROID_ROOT_FONT).toBe("9px");
    expect(rootFontSizeFor("xsmall", ANDROID)).toBe("9px");
    expect(rootFontSizeFor("normal", ANDROID)).toBe("9px");
  });

  it("falls back to 16px for an unknown scale on desktop", () => {
    expect(rootFontSizeFor("bogus", DESKTOP)).toBe("16px");
  });
});
