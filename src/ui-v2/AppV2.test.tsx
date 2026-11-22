import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";

import i18n from "@/i18n";
import { useBugReportStore } from "@/store/bugReportStore";
import { resetRosterUpdatesForTests, useRosterUpdateStore } from "@/store/rosterUpdateStore";
import { useGameStore } from "@/store/gameStore";
import type { GameStateData } from "@/store/types";
import { useSettingsStore } from "@/store/settingsStore";
import AppV2, { AppContent } from "./AppV2";

// ─── Mocks ───────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

const overlay = vi.hoisted(() => ({
  getWorldOverlayInfo: vi.fn(() => new Promise(() => {})),
  updateWorldOverlay: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/services/worldOverlayService", () => ({
  getWorldOverlayInfo: overlay.getWorldOverlayInfo,
  updateWorldOverlay: overlay.updateWorldOverlay,
}));

vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({
    updateAvailable: false,
    updateInfo: null,
    checking: false,
    downloading: false,
    progress: null,
    error: null,
    dismissed: false,
    install: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/ui-v2/components/TitleBarV2", () => ({
  TitleBarV2: () => <div data-testid="title-bar" />,
}));

vi.mock("@/ui-v2/dashboard/DashboardV2", () => ({
  default: () => <div data-testid="dashboard" />,
}));

vi.mock("@/ui-v2/_legacy/components/dashboard/FloatingBugButton", () => ({
  default: () => <div data-testid="floating-bug-button" />,
}));

vi.mock("@/ui-v2/_legacy/pages/MainMenu", () => ({
  default: () => <div data-testid="main-menu" />,
}));

vi.mock("@/ui-v2/pages/TeamSelectionV2", () => ({
  default: () => <div data-testid="team-selection" />,
}));

vi.mock("@/ui-v2/_legacy/pages/MatchSimulation", () => ({
  default: () => <div data-testid="match-simulation" />,
}));

vi.mock("@/ui-v2/pages/SettingsV2", () => ({
  default: () => <div data-testid="settings" />,
}));

// ─── Tests ───────────────────────────────────────────────────────────────

describe("AppContent bug button", () => {
  it.each(["/select-team", "/match", "/dashboard", "/finanzas", "/competitions", "/settings", "/"])(
    "never floats over %s: each screen hosts its own button",
    (route) => {
      render(
        <MemoryRouter initialEntries={[route]}>
          <AppContent />
        </MemoryRouter>,
      );

      expect(screen.queryByTestId("floating-bug-button")).toBeNull();
    },
  );
});

describe("AppContent route/tab sync", () => {
  beforeEach(() => {
    useBugReportStore.setState({
      currentRoute: "",
      currentDashboardTab: "",
    });
  });

  it("records the current route in bug-report context", async () => {
    render(
      <MemoryRouter initialEntries={["/finanzas"]}>
        <AppContent />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(useBugReportStore.getState().currentRoute).toBe("/finanzas"),
    );
  });

  it("clears the dashboard tab when landing on a non-dashboard route", async () => {
    useBugReportStore.setState({ currentDashboardTab: "Finances" });

    render(
      <MemoryRouter initialEntries={["/match"]}>
        <AppContent />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(useBugReportStore.getState().currentDashboardTab).toBe(""),
    );
  });

  it("clears the dashboard tab when navigating away from a dashboard route", async () => {
    useBugReportStore.setState({ currentDashboardTab: "Finances" });

    function Navigator() {
      const navigate = useNavigate();
      return (
        <button onClick={() => navigate("/match")}>go to match</button>
      );
    }

    render(
      <MemoryRouter initialEntries={["/finanzas"]}>
        <AppContent />
        <Navigator />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(useBugReportStore.getState().currentRoute).toBe("/finanzas"),
    );
    expect(useBugReportStore.getState().currentDashboardTab).toBe("Finances");

    fireEvent.click(screen.getByRole("button", { name: "go to match" }));

    await waitFor(() =>
      expect(useBugReportStore.getState().currentRoute).toBe("/match"),
    );
    expect(useBugReportStore.getState().currentDashboardTab).toBe("");
  });
});

describe("AppV2 high contrast", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.contrast;
  });

  function renderWithContrast(highContrast: boolean) {
    useSettingsStore.setState({
      loaded: true,
      settings: { ...useSettingsStore.getState().settings, high_contrast: highContrast },
    });
    return render(<AppV2 />);
  }

  it("sets data-contrast=high on the root element when high_contrast is on", async () => {
    renderWithContrast(true);
    await waitFor(() =>
      expect(document.documentElement.dataset.contrast).toBe("high"),
    );
  });

  it("removes data-contrast when high_contrast is off", async () => {
    document.documentElement.dataset.contrast = "high";
    renderWithContrast(false);
    await waitFor(() =>
      expect(document.documentElement.dataset.contrast).toBeUndefined(),
    );
  });
});

describe("AppV2 platform", () => {
  const ANDROID_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
  let userAgent: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete document.documentElement.dataset.platform;
    useSettingsStore.setState({ loaded: true });
    userAgent = vi.spyOn(window.navigator, "userAgent", "get");
  });

  afterEach(() => {
    userAgent.mockRestore();
    delete document.documentElement.dataset.platform;
  });

  it("flags the root as android and renders no title bar there", async () => {
    userAgent.mockReturnValue(ANDROID_UA);
    render(<AppV2 />);
    await waitFor(() => expect(document.documentElement.dataset.platform).toBe("android"));
    expect(screen.queryByTestId("title-bar")).toBeNull();
  });

  it("leaves the root unflagged and keeps the title bar on desktop", () => {
    userAgent.mockReturnValue("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
    render(<AppV2 />);
    expect(document.documentElement.dataset.platform).toBeUndefined();
    expect(screen.getByTestId("title-bar")).toBeInTheDocument();
  });
});

describe("AppV2 roster launch check", () => {
  beforeEach(() => {
    resetRosterUpdatesForTests();
    overlay.updateWorldOverlay.mockClear();
    useSettingsStore.setState({ loaded: true });
  });

  it("starts one automatic roster check per session without waiting for it", () => {
    const first = render(<AppV2 />);

    expect(overlay.updateWorldOverlay).toHaveBeenCalledTimes(1);
    expect(overlay.updateWorldOverlay).toHaveBeenCalledWith({ automatic: true });
    expect(useRosterUpdateStore.getState().status).toBe("checking");
    expect(screen.getByTestId("app-root")).toBeInTheDocument();

    first.unmount();
    render(<AppV2 />);

    expect(overlay.updateWorldOverlay).toHaveBeenCalledTimes(1);
  });
});

describe("AppV2 safe areas", () => {
  it("pads the app root with the four safe-area tokens", () => {
    useSettingsStore.setState({ loaded: true });
    render(<AppV2 />);
    const root = screen.getByTestId("app-root");
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(root.className).toContain(`var(--safe-${side})`);
    }
  });
});

describe("AppV2 document language", () => {
  it("mirrors the active i18n language on <html lang> on load and on every change", async () => {
    document.documentElement.lang = "xx";
    useSettingsStore.setState({
      loaded: true,
      settings: { ...useSettingsStore.getState().settings, language: i18n.language },
    });
    render(<AppV2 />);
    await waitFor(() => expect(document.documentElement.lang).toBe(i18n.language));

    await act(async () => {
      await i18n.changeLanguage("es");
    });
    expect(document.documentElement.lang).toBe("es");

    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    expect(document.documentElement.lang).toBe("fr");
  });
});

describe("AppContent club colours", () => {
  const RAYO = {
    id: "lec-custom-rayo",
    name: "Rayo",
    logo_url: "data:image/svg+xml;utf8,badge",
    colors: { primary: "#047857", secondary: "#fde047" },
  };

  beforeEach(() => {
    useGameStore.setState({
      gameState: { manager: { team_id: RAYO.id }, teams: [RAYO] } as unknown as GameStateData,
    });
  });

  afterEach(() => {
    useGameStore.setState({ gameState: null });
    for (const name of ["--club", "--club-foreground", "--club-text", "--club-secondary"]) {
      document.documentElement.style.removeProperty(name);
    }
    delete document.documentElement.dataset.clubSource;
  });

  it("applies the managed club colours on in-game routes", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppContent />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.documentElement.dataset.clubSource).toBe("custom"));
    expect(document.documentElement.style.getPropertyValue("--club")).not.toBe("");
  });

  it.each([
    ["/", "main-menu"],
    ["/settings", "settings"],
  ])("keeps the theme colours on %s even if the store still holds a game", async (route, testId) => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <AppContent />
      </MemoryRouter>,
    );
    await screen.findByTestId(testId);
    expect(document.documentElement.dataset.clubSource).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--club")).toBe("");
  });
});
