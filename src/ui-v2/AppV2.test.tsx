import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";

import { useBugReportStore } from "@/store/bugReportStore";
import { useSettingsStore } from "@/store/settingsStore";
import AppV2, { AppContent } from "./AppV2";

// ─── Mocks ───────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
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
  TitleBarV2: () => null,
}));

vi.mock("@/ui-v2/dashboard/DashboardV2", () => ({
  default: () => <div data-testid="dashboard" />,
}));

vi.mock("@/ui-v2/_legacy/components/dashboard/FloatingBugButton", () => ({
  default: () => null,
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
