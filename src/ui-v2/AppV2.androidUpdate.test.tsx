import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppV2 from "./AppV2";

const openUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl, revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@/services/worldOverlayService", () => ({
  getWorldOverlayInfo: vi.fn(() => new Promise(() => {})),
  updateWorldOverlay: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({
    updateAvailable: false,
    updateInfo: null,
    checking: false,
    downloading: false,
    progress: null,
    error: null,
    noPlatformBuild: true,
    dismissed: false,
    install: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/ui-v2/components/TitleBarV2", () => ({ TitleBarV2: () => <div /> }));
vi.mock("@/ui-v2/dashboard/DashboardV2", () => ({ default: () => <div /> }));
vi.mock("@/ui-v2/_legacy/pages/MainMenu", () => ({ default: () => <button>Main menu</button> }));
vi.mock("@/ui-v2/pages/TeamSelectionV2", () => ({ default: () => <div /> }));
vi.mock("@/ui-v2/_legacy/pages/MatchSimulation", () => ({ default: () => <div /> }));
vi.mock("@/ui-v2/pages/SettingsV2", () => ({ default: () => <div /> }));

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";
const RELEASE_URL = "https://github.com/ProphetLemon/OLManager/releases/latest";

function launchOn(userAgent: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  return render(<AppV2 />);
}

describe("AppV2 launch notice when the release has no build for this system", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    openUrl.mockClear();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("on Android shows a named dialog that opens the release page", async () => {
    launchOn(ANDROID_UA);

    const dialog = await screen.findByRole("dialog", { name: /update available/i });
    expect(dialog).toHaveTextContent(/download the new apk/i);

    const download = screen.getByRole("button", { name: /download the new apk/i });
    expect(download).toHaveClass("h-[var(--hit)]");
    fireEvent.click(download);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(RELEASE_URL));
  });

  it("hides for this launch with Later and with Escape", async () => {
    const view = launchOn(ANDROID_UA);
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: /^later$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.unmount();

    launchOn(ANDROID_UA);
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("moves focus into the dialog", async () => {
    launchOn(ANDROID_UA);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  });

  it("shows nothing on desktop", async () => {
    launchOn(LINUX_UA);
    await screen.findByRole("button", { name: "Main menu" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
