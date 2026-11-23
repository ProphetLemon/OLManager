import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/store/settingsStore";
import Settings from "./Settings";

const check = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => {
    const [checking, setChecking] = useState(false);
    return {
      updateAvailable: false,
      updateInfo: null,
      noPlatformBuild: false,
      checking,
      error: null,
      check: () => {
        check.calls += 1;
        setChecking(true);
        setTimeout(() => setChecking(false), 0);
      },
    };
  },
}));

describe("Settings > Updates keyboard focus", () => {
  it("keeps focus on 'Check now' while and after the check runs, and ignores presses meanwhile", async () => {
    useSettingsStore.setState({ loaded: true });
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /updates/i }));
    const button = screen.getByRole("button", { name: /check now/i });
    button.focus();

    await act(async () => {
      fireEvent.click(button);
    });
    const busy = screen.getByRole("button", { name: /checking/i });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).not.toBeDisabled();
    fireEvent.click(busy);
    expect(check.calls).toBe(1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /check now|up to date/i }));
    expect(document.activeElement).not.toBe(document.body);
  });
});
