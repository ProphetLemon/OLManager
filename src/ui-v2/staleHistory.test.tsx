import { act, render, screen } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMenuBackExit } from "@/hooks/useMenuBackExit";
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

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const exitApp = vi.fn(() => Promise.resolve());

function Menu({ guarded, userAgent }: { guarded: boolean; userAgent: string }) {
  const navigate = useNavigate();
  useMenuBackExit(guarded && /Android/.test(userAgent), exitApp);
  return (
    <div>
      <p>main-menu</p>
      <button onClick={() => navigate("/settings")}>open-settings</button>
    </div>
  );
}

function Settings() {
  return <p>settings-page</p>;
}

async function pressBack() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

// What a played session leaves behind: the menu, then the dashboard and match entries that
// loading, playing a day and returning pushed. Leaving the game replaced the top entry with "/".
function leaveStaleHistory(pairs: number) {
  window.history.replaceState(null, "", "/");
  window.history.pushState(null, "", "/dashboard");
  for (let i = 0; i < pairs; i += 1) {
    window.history.pushState(null, "", "/match");
    window.history.pushState(null, "", "/dashboard");
  }
  window.history.replaceState(null, "", "/");
}

async function renderApp(options: { guarded: boolean; userAgent: string }) {
  const DashboardV2 = (await import("@/ui-v2/dashboard/DashboardV2")).default;
  Object.defineProperty(window.navigator, "userAgent", { value: options.userAgent, configurable: true });
  return render(
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Menu guarded={options.guarded} userAgent={options.userAgent} />} />
        <Route path="/dashboard" element={<DashboardV2 />} />
        <Route path="/match" element={<p>match-without-game</p>} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>,
  );
}

describe("Back after leaving a game", () => {
  beforeEach(() => {
    exitApp.mockClear();
    useGameStore.setState({ hasActiveGame: false, gameState: null });
    useSettingsStore.setState({ loaded: true });
  });

  it("without a guard, Back on the menu walks into the dead dashboard screens one entry at a time", async () => {
    leaveStaleHistory(15);
    await renderApp({ guarded: false, userAgent: ANDROID });
    await screen.findByText("main-menu");

    let deadScreens = 0;
    for (let i = 0; i < 6; i += 1) {
      await pressBack();
      if (screen.queryByText("No active game")) deadScreens += 1;
      if (screen.queryByText("main-menu")) break;
    }
    expect(deadScreens).toBeGreaterThan(0);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("closes the app once when Back is pressed on the menu on Android, whatever lies behind it", async () => {
    leaveStaleHistory(15);
    await renderApp({ guarded: true, userAgent: ANDROID });
    await screen.findByText("main-menu");

    await pressBack();

    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("does not close the app when the menu is reached by Back from a screen it opened", async () => {
    window.history.replaceState(null, "", "/");
    await renderApp({ guarded: true, userAgent: ANDROID });
    await act(async () => {
      screen.getByRole("button", { name: "open-settings" }).click();
    });
    await screen.findByText("settings-page");

    await pressBack();

    await screen.findByText("main-menu");
    expect(exitApp).not.toHaveBeenCalled();

    await pressBack();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("never closes the app on desktop", async () => {
    leaveStaleHistory(3);
    await renderApp({ guarded: true, userAgent: DESKTOP });
    await screen.findByText("main-menu");

    await pressBack();

    expect(exitApp).not.toHaveBeenCalled();
  });
});
