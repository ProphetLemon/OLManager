import { render, screen } from "@testing-library/react";
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
