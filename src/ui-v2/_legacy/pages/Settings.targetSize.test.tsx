import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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
