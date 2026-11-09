import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGameStore } from "@/store/gameStore";
import { useBugReportStore } from "@/store/bugReportStore";
import type { GameStateData } from "@/store/gameStore";
import FloatingBugButton from "./FloatingBugButton";

// ─── Mocks ───────────────────────────────────────────────────────────────

vi.mock("@/services/bugReportService", () => ({
  exportBugReport: vi.fn(() => Promise.resolve("/path/to/report.zip")),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("@/ui-v2/_legacy/components/dashboard/dashboardHelpers", () => ({
  getManagerTeamName: () => "Test Team",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────

function minimalGameState(): GameStateData {
  return {
    manager: { team_id: "team-1" },
    teams: [{ id: "team-1", name: "Test Team" }],
    leagues: [{ name: "Test League" }],
    clock: { current_date: "2025-06-19" },
    day_phase: "Morning",
    champion_patch: { current_patch_label: "15.12" },
  } as unknown as GameStateData;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("FloatingBugButton", () => {
  beforeEach(() => {
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: minimalGameState(),
      isDirty: false,
      showFiredModal: false,
    });
    useBugReportStore.setState({
      currentRoute: "",
      currentDashboardTab: "",
    });
  });

  it("keeps the floating button mounted and returns focus to it when the modal closes", async () => {
    render(<FloatingBugButton />);

    const button = screen.getByRole("button", { name: "Reportar Bug" });
    act(() => button.focus());
    fireEvent.click(button);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTitle("Reportar Bug")).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("keeps the floating button mounted after opening the report modal", () => {
    useBugReportStore.setState({
      currentRoute: "/match",
      currentDashboardTab: "",
    });

    render(<FloatingBugButton />);

    const button = screen.getByTitle("Reportar Bug");
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    expect(screen.getByTitle("Reportar Bug")).toBeInTheDocument();
    expect(screen.getByText("Report bug / suggest improvement")).toBeInTheDocument();
  });

  it("shows the current route and active dashboard tab in the context preview", () => {
    useBugReportStore.setState({
      currentRoute: "/finanzas",
      currentDashboardTab: "Finances",
    });

    render(<FloatingBugButton />);
    fireEvent.click(screen.getByTitle("Reportar Bug"));

    const preview = screen.getByText((content) =>
      content.includes("/finanzas"),
    );
    expect(preview).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("Finances"))).toBeInTheDocument();
  });

  it("does not include a stale dashboard tab in the exported context when the tab is cleared", async () => {
    const { exportBugReport } = await import("@/services/bugReportService");

    useBugReportStore.setState({
      currentRoute: "/match",
      currentDashboardTab: "",
    });

    render(<FloatingBugButton />);
    fireEvent.click(screen.getByTitle("Reportar Bug"));

    const textarea = screen.getByPlaceholderText("Describe what happened, what you expected, and how to reproduce it...");
    fireEvent.change(textarea, { target: { value: "Something went wrong" } });

    fireEvent.click(screen.getByText("Generate report"));

    await waitFor(() => expect(exportBugReport).toHaveBeenCalled());

    const exportedContext = JSON.parse(
      (exportBugReport as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(exportedContext.route).toBe("/match");
    expect(exportedContext.activeTab).toBe("");
    expect(exportedContext.activeTab).not.toBe("Finances");
  });

  it("renders a 44px accessible icon button in the rail placement", () => {
    render(<FloatingBugButton placement="rail" />);

    const button = screen.getByRole("button", { name: "Reportar Bug" });
    expect(button).toHaveAttribute("title", "Reportar Bug");
    expect(button.className).toContain("size-[var(--hit)]");
    expect(button.className).not.toContain("fixed");

    fireEvent.click(button);
    expect(screen.getByText("Report bug / suggest improvement")).toBeInTheDocument();
  });

  it("keeps the floating placement fixed by default", () => {
    render(<FloatingBugButton />);
    expect(screen.getByTitle("Reportar Bug").className).toContain("fixed");
  });
});
