import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/store/settingsStore";
import Settings from "./Settings";

const outcome = vi.hoisted(() => ({ error: null as string | null }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
// A stand-in for the real hook: "Check now" goes checking -> finished, with or without an error.
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => {
    const [state, setState] = useState({ checking: false, error: null as string | null });
    return {
      updateAvailable: false,
      updateInfo: null,
      noPlatformBuild: false,
      checking: state.checking,
      error: state.error,
      check: () => {
        setState({ checking: true, error: null });
        setTimeout(() => setState({ checking: false, error: outcome.error }), 0);
      },
    };
  },
}));

async function runCheck() {
  useSettingsStore.setState({ loaded: true });
  render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /updates/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /check now/i }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("Settings > Updates when the check itself fails", () => {
  afterEach(() => {
    outcome.error = null;
  });

  it("says the check could not be made instead of 'up to date'", async () => {
    outcome.error = "offline";
    await runCheck();

    expect(screen.getByText(/couldn't check for updates/i)).toBeInTheDocument();
    expect(screen.queryByText(/you're up to date/i)).not.toBeInTheDocument();
  });

  it("still says 'up to date' when the check succeeds with nothing new", async () => {
    await runCheck();

    expect(screen.getByText(/you're up to date/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't check for updates/i)).not.toBeInTheDocument();
  });
});
