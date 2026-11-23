import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { ScrimReportPane, type ScrimReportPaneProps } from "./ScrimReportPane";
import { makeReport } from "./scrimDayFixtures";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const NAMES = new Map([
  ["mvk", "MVK Esports"],
  ["gam", "GAM Esports"],
]);

function week(over: Partial<WeeklyScrimContext> = {}): WeeklyScrimContext {
  return {
    weekKey: "2026-w1",
    objective: "EarlyGame",
    capacity: 6,
    planned: 2,
    reputation: 50,
    cancellations: 0,
    played: 2,
    wins: 1,
    losses: 1,
    lossStreak: 1,
    avgQuality: 63,
    topFocus: null,
    topIssue: null,
    nextOfficialRivalTeamId: null,
    nextOfficialRivalCompetition: null,
    setupLocked: true,
    setupLockedReason: null,
    canFinalizeSetup: false,
    slots: [],
    latestReports: [makeReport({ won: false, quality: 61 }), makeReport({ slot_index: 1, won: true, opponent_team_id: "gam", quality: 64, issue: null })],
    ...over,
  };
}

function setup(props: Partial<ScrimReportPaneProps> = {}) {
  return render(<ScrimReportPane week={week()} teamNameById={NAMES} suggestions={["Add fallbacks when rivals have better rep."]} {...props} />);
}

describe("ScrimReportPane", () => {
  it("is headed Weekly Report, names the pane and lets the parent focus the heading", () => {
    setup();
    const heading = screen.getByRole("heading", { level: 2, name: "Weekly Report" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("group", { name: "Weekly Report" })).toBeInTheDocument();
  });

  it("shows the record, the quality, the streak and the played count", () => {
    const { container } = setup();
    const stats = container.querySelector('[data-slot="report-stats"]') as HTMLElement;
    expect(within(stats).getByText("Week Record").nextSibling).toHaveTextContent("1-1");
    expect(within(stats).getByText("Quality").nextSibling).toHaveTextContent("Q: 63");
    expect(within(stats).getByText("Streaks").nextSibling).toHaveTextContent("1L streak");
    expect(within(stats).getByText("Played").nextSibling).toHaveTextContent("2");
  });

  it("leaves quality and streaks out when there are none", () => {
    setup({ week: week({ avgQuality: 0, lossStreak: 0 }) });
    expect(screen.queryByText("Streaks")).toBeNull();
    expect(screen.queryByText("Q: 0")).toBeNull();
  });

  it("lists the three newest recent reports with the rival's name", () => {
    const reports = [1, 2, 3, 4].map((n) => makeReport({ slot_index: n, opponent_team_id: n % 2 ? "mvk" : "gam", quality: 60 + n }));
    setup({ week: week({ latestReports: reports }) });
    expect(screen.getByRole("heading", { level: 3, name: "Recent Reports" })).toBeInTheDocument();
    expect(screen.getAllByText(/^Q6\d$/)).toHaveLength(3);
    expect(screen.getAllByText("MVK Esports").length).toBeGreaterThan(0);
  });

  it("says the existing empty text when there are no reports, and the record is still there", () => {
    setup({ week: week({ latestReports: [], played: 0, wins: 0, losses: 0, avgQuality: 0, lossStreak: 0 }) });
    expect(screen.getByText("No recent reports")).toBeInTheDocument();
    expect(screen.getByText("Complete scrims to generate the weekly summary.")).toBeInTheDocument();
    expect(screen.getByText("0-0")).toBeInTheDocument();
  });

  it("puts the staff suggestions under their own subheading, and nothing when there are none", () => {
    const { unmount } = setup();
    expect(screen.getByRole("heading", { level: 3, name: "Staff suggestions" })).toBeInTheDocument();
    expect(screen.getByText("Add fallbacks when rivals have better rep.")).toBeInTheDocument();
    unmount();
    setup({ suggestions: [] });
    expect(screen.queryByText("Staff suggestions")).toBeNull();
  });

  it("scrolls inside itself and has no live region", () => {
    const { container } = setup();
    const pane = container.querySelector('[data-slot="scrim-report-pane"]') as HTMLElement;
    expect(pane.className).toContain("overflow-y-auto");
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
