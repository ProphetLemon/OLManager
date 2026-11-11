import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/store/settingsStore";
import Settings from "./Settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({
    updateAvailable: false,
    updateInfo: null,
    checking: false,
    noPlatformBuild: false,
    check: vi.fn(),
  }),
}));

describe("Settings segmented controls", () => {
  it("gives every UI scale button the minimum target size", () => {
    useSettingsStore.setState({ loaded: true });
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
    for (const label of ["XS", "S", "M", "L", "XL"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveClass("min-h-[var(--target-min)]", "min-w-[var(--target-min)]");
    }
  });
});

describe("Settings switches", () => {
  function renderSettings() {
    useSettingsStore.setState({ loaded: true });
    return render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
  }

  it("exposes the high-contrast toggle as a named switch with the minimum target size", () => {
    renderSettings();
    const toggle = screen.getByRole("switch", { name: /high contrast/i });

    expect(toggle).toHaveAttribute("aria-checked", String(useSettingsStore.getState().settings.high_contrast));
    expect(toggle).toHaveAccessibleDescription(/readability/i);
    expect(toggle).toHaveClass("min-h-[var(--target-min)]", "min-w-[var(--target-min)]");
    expect(toggle).toHaveAttribute("type", "button");
  });

  it("flips aria-checked when the switch is pressed", () => {
    renderSettings();
    const toggle = screen.getByRole("switch", { name: /high contrast/i });
    const before = toggle.getAttribute("aria-checked");

    fireEvent.click(toggle);

    expect(screen.getByRole("switch", { name: /high contrast/i }).getAttribute("aria-checked")).not.toBe(before);
  });

  it("names every switch of the page after its visible label and gives each the floor", () => {
    renderSettings();
    const seen = new Set<string>();

    for (const tab of [/display/i, /gameplay/i, /saves/i]) {
      fireEvent.click(screen.getByRole("button", { name: tab }));
      for (const toggle of screen.getAllByRole("switch")) {
        expect(toggle, toggle.outerHTML).toHaveAccessibleName(/\S/);
        expect(toggle).toHaveClass("min-h-[var(--target-min)]", "min-w-[var(--target-min)]");
        seen.add(toggle.getAttribute("aria-labelledby") ?? "");
      }
    }

    // high contrast, match commentary, confirm advance, debug tools and auto-save
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(seen.has("")).toBe(false);
  });
});

describe("Settings graphics mode", () => {
  const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15";
  const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";

  function renderWithUserAgent(userAgent: string, updateSettings = vi.fn().mockResolvedValue(undefined)) {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
    useSettingsStore.setState({
      loaded: true,
      updateSettings,
      settings: { ...useSettingsStore.getState().settings, linux_render_mode: "ask" },
    });
    return render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
  }

  const originalUpdateSettings = useSettingsStore.getState().updateSettings;

  afterEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({ updateSettings: originalUpdateSettings });
  });

  it("shows the three-way control on Linux", () => {
    renderWithUserAgent(LINUX_UA);

    expect(screen.getByRole("button", { name: "Ask at start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fast (recommended)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compatibility" })).toBeInTheDocument();
  });

  it("does not show the control on Windows", () => {
    renderWithUserAgent(WINDOWS_UA);

    expect(screen.queryByRole("button", { name: "Compatibility" })).not.toBeInTheDocument();
  });

  it("does not show the control on Android, whose user agent also says Linux", () => {
    renderWithUserAgent(ANDROID_UA);

    expect(screen.queryByRole("button", { name: "Compatibility" })).not.toBeInTheDocument();
  });

  it("saves the chosen mode through the settings store", () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    renderWithUserAgent(LINUX_UA, updateSettings);

    fireEvent.click(screen.getByRole("button", { name: "Compatibility" }));

    expect(updateSettings).toHaveBeenCalledWith({ linux_render_mode: "compatibility" });
  });
});
