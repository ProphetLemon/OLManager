import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { useGameStore } from "@/store/gameStore";
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

describe("Settings > Gameplay", () => {
  it("offers the SoloQ decay control, disabled while no save is loaded", () => {
    useSettingsStore.setState({ loaded: true });
    useGameStore.setState({ hasActiveGame: false });
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("soloq-decay-setting")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /gameplay/i }));

    const control = screen.getByTestId("soloq-decay-setting");
    expect(control).toBeInTheDocument();
    expect(control.querySelector('[role="switch"]')).toBeDisabled();
  });
});
