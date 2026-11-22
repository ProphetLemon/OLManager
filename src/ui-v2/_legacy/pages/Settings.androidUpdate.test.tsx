import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/store/settingsStore";
import Settings from "./Settings";

const openUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl, revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({
    updateAvailable: false,
    updateInfo: null,
    checking: false,
    noPlatformBuild: true,
    check: vi.fn(),
  }),
}));

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";
const RELEASE_URL = "https://github.com/ProphetLemon/OLManager/releases/latest";

function renderOn(userAgent: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  useSettingsStore.setState({ loaded: true });
  const view = render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /updates/i }));
  return view;
}

describe("Settings > Updates when the release has no build for this system", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    openUrl.mockClear();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("on Android says a new version is out and links to the release page", async () => {
    renderOn(ANDROID_UA);

    expect(screen.queryByText(/no build for your system/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^a new version is available\./i)).toBeInTheDocument();
    expect(screen.getByText(/keeps your saves/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /download the new apk/i }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(RELEASE_URL));
  });

  it("gives the Android download button the touch target floor", () => {
    renderOn(ANDROID_UA);

    expect(screen.getByRole("button", { name: /download the new apk/i })).toHaveClass(
      "min-h-[var(--hit)]",
    );
  });

  it("on desktop keeps the existing message and offers no APK link", () => {
    renderOn(LINUX_UA);

    expect(screen.getByText(/no build for your system/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download the new apk/i })).not.toBeInTheDocument();
  });
});
