import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardSidebarV2 } from "./DashboardSidebarV2";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "es" },
    t: (key: string) => key,
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
  return screen.getByRole("button", { name: /dashboard\.transfers/ });
}

describe("DashboardSidebarV2 transfers badge", () => {
  it("shows the pending incoming offer count on the transfers item", () => {
    expect(renderSidebar(3)).toHaveTextContent("3");
  });

  it("hides the badge when there are no pending offers", () => {
    expect(renderSidebar(0)).not.toHaveTextContent(/\d/);
  });
});
