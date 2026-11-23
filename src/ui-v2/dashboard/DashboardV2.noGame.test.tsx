import { act, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "get_active_game") return Promise.resolve(null);
    return Promise.resolve();
  }),
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateFromEnglish } = await import("@/test-i18n");
  return { ...actual, useTranslation: () => ({ t: translateFromEnglish, i18n: { language: "en" } }) };
});

describe("DashboardV2 without an active game", () => {
  beforeEach(() => {
    useGameStore.setState({ hasActiveGame: false, gameState: null });
    useSettingsStore.setState({ loaded: true });
  });

  it("leaves a way out of the dead dashboard screen: a button to the menu that replaces the entry", async () => {
    window.history.replaceState(null, "", "/");
    window.history.pushState(null, "", "/dashboard");
    const DashboardV2 = (await import("./DashboardV2")).default;
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<p>main-menu</p>} />
          <Route path="/dashboard" element={<DashboardV2 />} />
        </Routes>
      </BrowserRouter>,
    );
    const lengthBefore = window.history.length;

    const button = await screen.findByRole("button", { name: /main menu/i });
    await act(async () => {
      button.click();
    });

    await waitFor(() => expect(screen.getByText("main-menu")).toBeInTheDocument());
    expect(window.location.pathname).toBe("/");
    expect(window.history.length).toBe(lengthBefore);
  });
});
