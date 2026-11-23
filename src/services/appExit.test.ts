import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({ exit: mocks.exit }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ destroy: mocks.destroy }),
}));

import { exitApp } from "./appExit";

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36";
const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

describe("exitApp", () => {
  beforeEach(() => {
    mocks.exit.mockReset().mockResolvedValue(undefined);
    mocks.destroy.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    Reflect.deleteProperty(document, "exitFullscreen");
  });

  it("ends the process on Android without destroying a window", async () => {
    await exitApp(ANDROID_UA);
    expect(mocks.exit).toHaveBeenCalledTimes(1);
    expect(mocks.exit).toHaveBeenCalledWith(0);
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("destroys the window on desktop", async () => {
    await exitApp(DESKTOP_UA);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.exit).not.toHaveBeenCalled();
  });

  it("leaves fullscreen before destroying the window on desktop", async () => {
    const order: string[] = [];
    Object.defineProperty(document, "fullscreenElement", { value: document.body, configurable: true });
    Object.defineProperty(document, "exitFullscreen", {
      value: vi.fn(async () => {
        order.push("exitFullscreen");
      }),
      configurable: true,
    });
    mocks.destroy.mockImplementation(async () => {
      order.push("destroy");
    });
    await exitApp(DESKTOP_UA);
    expect(order).toEqual(["exitFullscreen", "destroy"]);
  });
});
