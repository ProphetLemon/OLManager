import { beforeEach, describe, expect, it } from "vitest";

import { usePaletteStore } from "./paletteStore";

const store = () => usePaletteStore.getState();

describe("paletteStore (spec §5.1)", () => {
  beforeEach(() => store().reset());

  it("opens with the id of the control that opened it, and closes keeping that id", () => {
    store().openPalette("util:go");
    expect(store()).toMatchObject({ open: true, openerId: "util:go" });
    store().closePalette();
    expect(store()).toMatchObject({ open: false, openerId: "util:go" });
  });

  it("reset() closes it and forgets the opener", () => {
    store().openPalette("util:go");
    store().reset();
    expect(store()).toMatchObject({ open: false, openerId: null });
  });
});
