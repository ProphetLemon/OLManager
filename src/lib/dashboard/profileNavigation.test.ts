import { describe, expect, it } from "vitest";

import { createDashboardProfileNavigationState, navigateDashboardProfiles } from "./profileNavigation";

describe("navigateDashboardProfiles competition target", () => {
  it("keeps the competition to preselect and clears it on the next navigation", () => {
    const start = createDashboardProfileNavigationState("Inbox");
    const opened = navigateDashboardProfiles(start, "Competitions", { competitionId: "lec" });
    expect(opened.activeTab).toBe("Competitions");
    expect(opened.initialCompetitionId).toBe("lec");

    const next = navigateDashboardProfiles(opened, "Competitions");
    expect(next.initialCompetitionId).toBeNull();
  });
});
