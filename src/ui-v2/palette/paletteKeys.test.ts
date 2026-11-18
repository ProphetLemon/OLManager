import { describe, expect, it } from "vitest";

import { paletteKeyAction, type PaletteKeyState } from "./paletteKeys";

/** Two calls, three recents and two sections. */
const GROUPS = ["calls", "calls", "recent", "recent", "recent", "sections", "sections"];

const at = (activeIndex: number, query = ""): PaletteKeyState => ({ optionGroups: GROUPS, activeIndex, query });
const press = (state: PaletteKeyState, key: string, extra: { isComposing?: boolean; keyCode?: number } = {}) =>
  paletteKeyAction(state, { key, ...extra });

describe("paletteKeyAction: Up and Down", () => {
  it("move to the next and previous option", () => {
    expect(press(at(2), "ArrowDown")).toEqual({ type: "move", index: 3 });
    expect(press(at(2), "ArrowUp")).toEqual({ type: "move", index: 1 });
  });

  it("wrap at both ends", () => {
    expect(press(at(6), "ArrowDown")).toEqual({ type: "move", index: 0 });
    expect(press(at(0), "ArrowUp")).toEqual({ type: "move", index: 6 });
  });

  it("start at the first or the last option when none is active", () => {
    expect(press(at(-1), "ArrowDown")).toEqual({ type: "move", index: 0 });
    expect(press(at(-1), "ArrowUp")).toEqual({ type: "move", index: 6 });
  });

  it("do nothing with no options", () => {
    const empty = { optionGroups: [], activeIndex: -1, query: "zzz" };
    expect(press(empty, "ArrowDown")).toEqual({ type: "none" });
    expect(press(empty, "ArrowUp")).toEqual({ type: "none" });
  });
});

describe("paletteKeyAction: PageUp and PageDown", () => {
  it("jump to the first option of the next group", () => {
    expect(press(at(0), "PageDown")).toEqual({ type: "move", index: 2 });
    expect(press(at(3), "PageDown")).toEqual({ type: "move", index: 5 });
  });

  it("jump to the first option of the previous group, from anywhere in a group", () => {
    expect(press(at(5), "PageUp")).toEqual({ type: "move", index: 2 });
    expect(press(at(4), "PageUp")).toEqual({ type: "move", index: 0 });
  });

  it("do nothing past the first or the last group", () => {
    expect(press(at(6), "PageDown")).toEqual({ type: "none" });
    expect(press(at(1), "PageUp")).toEqual({ type: "none" });
  });

  it("start at the first group when no option is active", () => {
    expect(press(at(-1), "PageDown")).toEqual({ type: "move", index: 0 });
    expect(press(at(-1), "PageUp")).toEqual({ type: "none" });
  });
});

describe("paletteKeyAction: Enter and Escape", () => {
  it("Enter activates the active option", () => {
    expect(press(at(3), "Enter")).toEqual({ type: "activate", index: 3 });
  });

  it("Enter does nothing with no options or no active one", () => {
    expect(press({ optionGroups: [], activeIndex: -1, query: "zzz" }, "Enter")).toEqual({ type: "none" });
    expect(press(at(-1), "Enter")).toEqual({ type: "none" });
  });

  it("Escape clears a query and keeps the palette open", () => {
    expect(press(at(0, "sq"), "Escape")).toEqual({ type: "clear" });
  });

  it("Escape with an empty query closes the palette", () => {
    expect(press(at(0, ""), "Escape")).toEqual({ type: "close" });
  });
});

describe("paletteKeyAction: keys it leaves alone", () => {
  it("leaves Home, End, Tab and typing to the input and the focus trap", () => {
    for (const key of ["Home", "End", "Tab", "a", "Backspace"]) {
      expect(press(at(2, "sq"), key)).toEqual({ type: "none" });
    }
  });

  it("leaves every key to an IME composition in progress (R48)", () => {
    for (const key of ["Enter", "Escape", "ArrowDown", "ArrowUp", "PageDown", "PageUp"]) {
      expect(press(at(2, "sq"), key, { isComposing: true })).toEqual({ type: "none" });
      expect(press(at(2, "sq"), key, { keyCode: 229 })).toEqual({ type: "none" });
    }
  });
});
