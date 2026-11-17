import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settingsStore";
import { useRailMode } from "./useRailMode";

type RoCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private cb: RoCallback) {
    MockResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  emit(width: number, height: number) {
    this.cb([{ contentRect: { width, height } }]);
  }
}

const live = () => MockResizeObserver.instances.filter((o) => !o.disconnected);
const resize = (w: number, h: number) => act(() => live()[live().length - 1].emit(w, h));

function setRoot(px: number | null) {
  document.documentElement.style.fontSize = px === null ? "" : `${px}px`;
}

function setup() {
  const el = document.createElement("div");
  return renderHook(() => useRailMode(el));
}

beforeEach(() => {
  MockResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  setRoot(16);
  delete document.documentElement.dataset.platform;
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ui_scale: "normal" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setRoot(null);
  delete document.documentElement.dataset.platform;
});

describe("useRailMode", () => {
  it("observes the element and reports its content box once the observer fires", () => {
    const { result } = setup();
    expect(live()).toHaveLength(1);
    expect(live()[0].observed).toHaveLength(1);
    resize(1280, 764);
    expect(result.current).toEqual({ mode: "tree", slotW: 1280, slotH: 764, need: 622 });
  });

  it("is Split, today's rail, until the observer first fires", () => {
    const { result } = setup();
    expect(result.current).toMatchObject({ mode: "split", slotW: 0, slotH: 0 });
  });

  it("flips to split when the slot shrinks and back when it grows", () => {
    const { result } = setup();
    resize(1280, 764);
    expect(result.current.mode).toBe("tree");
    resize(960, 595);
    expect(result.current.mode).toBe("split");
    resize(1920, 1044);
    expect(result.current.mode).toBe("tree");
  });

  it("keeps the mode when the slot reports 0 x 0 after a real measurement (hidden or detached)", () => {
    const { result } = setup();
    resize(960, 595);
    expect(result.current.mode).toBe("split");
    resize(0, 0);
    expect(result.current.mode).toBe("split");
    resize(1104, 622); // the next real size still pays the re-entry margin
    expect(result.current.mode).toBe("split");
  });

  it("does not drop out of the tree on a 0 x 0 slot either", () => {
    const { result } = setup();
    resize(1280, 764);
    resize(0, 0);
    expect(result.current.mode).toBe("tree");
    resize(1104, 622); // no margin was imposed
    expect(result.current.mode).toBe("tree");
  });

  it("applies 16 px of hysteresis only when re-entering the tree", () => {
    const { result } = setup();
    resize(1104, 622); // exactly the thresholds at root 16
    expect(result.current.mode).toBe("tree");
    resize(1103, 622);
    expect(result.current.mode).toBe("split");
    resize(1104, 622); // back at the threshold: not enough to re-enter
    expect(result.current.mode).toBe("split");
    resize(1119, 638);
    expect(result.current.mode).toBe("split");
    resize(1120, 638);
    expect(result.current.mode).toBe("tree");
    resize(1104, 622); // staying in the tree needs no margin
    expect(result.current.mode).toBe("tree");
  });

  it("reads the root font size from the document and re-reads it when ui_scale changes", async () => {
    const { result } = setup();
    resize(1280, 755);
    expect(result.current).toMatchObject({ mode: "tree", need: 622 });

    setRoot(20);
    act(() => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ui_scale: "xlarge" } }));
    await waitFor(() => expect(result.current.need).toBe(765));
    expect(result.current.mode).toBe("split"); // 755 < 765
  });

  it("re-reads the root when only its inline style changes (AppV2 sets it in a later effect)", async () => {
    const { result } = setup();
    resize(1280, 755);
    setRoot(20);
    await waitFor(() => expect(result.current).toMatchObject({ need: 765, mode: "split" }));
  });

  it("reads the platform from data-platform, never the user agent, and is always split on android", async () => {
    document.documentElement.dataset.platform = "android";
    const { result } = setup();
    resize(5000, 5000);
    expect(result.current.mode).toBe("split");
    delete document.documentElement.dataset.platform;
    await waitFor(() => expect(result.current.mode).toBe("tree"));
  });

  it("falls back to 16 px when the root size cannot be read", () => {
    setRoot(null);
    const { result } = setup();
    resize(1280, 764);
    expect(result.current.need).toBe(622);
  });

  it("subtracts reservedTop from the height budget", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => useRailMode(el, { reservedTop: 50 }));
    resize(1280, 660);
    expect(result.current).toMatchObject({ mode: "split", need: 672 });
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = setup();
    const ro = live()[0];
    unmount();
    expect(ro.disconnected).toBe(true);
  });
});
