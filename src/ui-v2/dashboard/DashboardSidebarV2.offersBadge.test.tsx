import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardSidebarV2 } from "./DashboardSidebarV2";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "es" },
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

function renderSidebar(pendingOffersCount?: number) {
  render(
    <DashboardSidebarV2
      activeTab="Home"
      onNavClick={vi.fn()}
      unreadMessagesCount={0}
      managerName="Boss"
      teamName="Team"
      teamLogo={null}
      isUnemployed={false}
      onNavigateSettings={vi.fn()}
      onExitClick={vi.fn()}
      pendingOffersCount={pendingOffersCount}
    />,
  );
  return screen.getByRole("button", { name: /^Market/ });
}

describe("DashboardSidebarV2 market launcher badge", () => {
  it("shows the pending incoming offer count on the market launcher", () => {
    const launcher = renderSidebar(3);
    expect(launcher).toHaveTextContent("3");
    expect(launcher).toHaveAccessibleName("Market, 3");
  });

  it("hides the badge when there are no pending offers", () => {
    const launcher = renderSidebar(0);
    expect(launcher).not.toHaveTextContent(/\d/);
    expect(launcher).toHaveAccessibleName("Market");
  });
});
