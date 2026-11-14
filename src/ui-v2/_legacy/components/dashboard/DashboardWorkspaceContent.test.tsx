import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GameStateData } from "@/store/gameStore";
import { createDashboardTabContentModel } from "@/ui-v2/_legacy/components/dashboard/dashboardTabContentModel";
import DashboardWorkspaceContent from "@/ui-v2/_legacy/components/dashboard/DashboardWorkspaceContent";

vi.mock("./DashboardAlerts", () => ({
  default: ({ onNavigate }: any) => (
    <button onClick={() => onNavigate("Inbox")}>alerts-mock</button>
  ),
}));

vi.mock("./DashboardTabContent", () => ({
  default: ({ viewModel }: any) => <div>Tab Content {viewModel.activeTab}</div>,
}));

function createGameState(): GameStateData {
  return { manager: { id: "manager-1" } } as unknown as GameStateData;
}

describe("DashboardWorkspaceContent", () => {
  it("renders alerts and tab content", () => {
    const gameState = createGameState();
    const onNavigate = vi.fn();

    render(
      <DashboardWorkspaceContent
        dashboardAlerts={[
          { id: "alert-1", text: "Alert", tab: "Inbox", severity: "info" },
        ]}
        dashboardTabContentModel={createDashboardTabContentModel({
          activeTab: "Home",
          gameState,
          seasonComplete: false,
          visitedOnboardingTabs: new Set<string>(),
          initialMessageId: null,
          handlers: {
            onSelectPlayer: vi.fn(),
            onSelectTeam: vi.fn(),
            onGameUpdate: vi.fn(),
            onNavigate,
          },
        })}
        onNavigate={onNavigate}
        isUnemployed={false}
      />,
    );

    expect(screen.getByText("alerts-mock")).toBeInTheDocument();
    expect(screen.getByText("Tab Content Home")).toBeInTheDocument();

    fireEvent.click(screen.getByText("alerts-mock"));
    expect(onNavigate).toHaveBeenCalledWith("Inbox");
  });
});
