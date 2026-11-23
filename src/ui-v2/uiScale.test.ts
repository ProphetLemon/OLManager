import { describe, expect, it } from "vitest";
import {
  MIN_OFFERED_ROOT_FONT_PX,
  MIN_PHONE_ROOT_FONT_PX,
  SCALE_MAP,
  phoneRootFontPx,
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

  it("gives a phone the 16px root from phoneRootFontPx, also for a stored xsmall", () => {
    expect(phoneRootFontPx()).toBe(16);
    expect(rootFontSizeFor("xsmall", ANDROID)).toBe("16px");
    expect(rootFontSizeFor("normal", ANDROID)).toBe("16px");
    expect(rootFontSizeFor("xlarge", ANDROID)).toBe(`${phoneRootFontPx()}px`);
  });

  it("never lets the phone root fall under the phone floor, which keeps 0.75rem text at 12px", () => {
    expect(MIN_PHONE_ROOT_FONT_PX).toBe(16);
    expect(phoneRootFontPx()).toBeGreaterThanOrEqual(MIN_PHONE_ROOT_FONT_PX);
    expect(phoneRootFontPx() * 0.75).toBeGreaterThanOrEqual(12);
  });

  it("falls back to 16px for an unknown scale on desktop", () => {
    expect(rootFontSizeFor("bogus", DESKTOP)).toBe("16px");
  });
});
