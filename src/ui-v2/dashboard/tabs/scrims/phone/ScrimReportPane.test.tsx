import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import type { TeamData } from "@/store/gameStore";
import { ScrimReportPane, type ScrimReportPaneProps } from "./ScrimReportPane";
import { makeReport } from "./scrimDayFixtures";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const NAMES = new Map([
  ["mvk", "MVK Esports"],
  ["gam", "GAM Esports"],
]);
const TEAMS = [
  { id: "mvk", name: "MVK Esports", short_name: "MVK", logo_url: null },
  { id: "gam", name: "GAM Esports", short_name: "GAM", logo_url: null },
] as unknown as TeamData[];

const slotLabelOf = (slot: { labelDay: number; labelSuffix: string } | undefined) => (slot ? `Wed ${slot.labelSuffix}` : "");

function week(over: Partial<WeeklyScrimContext> = {}): WeeklyScrimContext {
  return {
    weekKey: "2026-w1",
    objective: "EarlyGame",
    capacity: 6,
    planned: 2,
    reputation: 25,
    cancellations: 1,
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
    slots: [
      { slotIndex: 0, weekday: 2, label: "x", labelDay: 2, labelSuffix: "A", plan: [], resolvedOpponentTeamId: null, resultWon: null, report: null, status: "Played", canEdit: false },
      { slotIndex: 1, weekday: 2, label: "x", labelDay: 2, labelSuffix: "B", plan: [], resolvedOpponentTeamId: null, resultWon: null, report: null, status: "Played", canEdit: false },
    ],
    latestReports: [makeReport({ won: false, quality: 68 }), makeReport({ slot_index: 1, won: true, opponent_team_id: "gam", quality: 64, issue: null })],
    ...over,
  };
}

function setup(over: Partial<ScrimReportPaneProps> = {}) {
  const onBack = vi.fn();
  const utils = render(
    <ScrimReportPane
      title="Report"
      onBack={onBack}
      week={week()}
      teams={TEAMS}
      teamNameById={NAMES}
      slotLabelOf={slotLabelOf}
      suggestions={["Add fallbacks when rivals have better rep."]}
      {...over}
    />,
  );
  return { onBack, ...utils };
}

const block = (container: HTMLElement) => container.querySelector('[data-slot="report-block"]') as HTMLElement;
const emptyWeek = () => week({ latestReports: [], played: 0, wins: 0, losses: 0, avgQuality: 0, lossStreak: 0, cancellations: 0 });

describe("ScrimReportPane in its frame", () => {
  it("has one heading, the frame's title, and a back control that goes back", () => {
    const { onBack } = setup();
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Report");
    fireEvent.click(screen.getByRole("button", { name: "Back: Report" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("draws no card around the whole view and scrolls inside itself only", () => {
    const { container } = setup();
    expect((container.querySelector('[data-slot="scrim-view-body"]') as HTMLElement).className).not.toContain("bg-card");
    const pane = container.querySelector('[data-slot="scrim-report-pane"]') as HTMLElement;
    expect(pane).toHaveAttribute("role", "group");
    expect(pane).toHaveAccessibleName("Weekly Report");
    expect(pane.className).toContain("overflow-y-auto");
    // The pane scrolls; the only other scroller is the frame's body, which scrolls as a safety.
    expect(pane.querySelectorAll('[class*="overflow-y-auto"]')).toHaveLength(0);
    expect(container.querySelectorAll('[class*="overflow-y-auto"]')).toHaveLength(2);
    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});

describe("ScrimReportPane the week", () => {
  it("shows the record large with its name, then the played count and the streak with an icon and words", () => {
    const { container } = setup();
    const record = container.querySelector('[data-slot="report-record"]') as HTMLElement;
    expect(record).toHaveTextContent("1-1");
    expect(record.className).toContain("text-ovr");
    expect(screen.getByText("Week Record")).toBeInTheDocument();
    expect(screen.getByText("Played").nextSibling).toHaveTextContent("2");
    const streak = screen.getByText("1L streak");
    expect(streak.closest("p")?.querySelector("svg")).not.toBeNull();
  });

  it("leaves the streak out when there is none", () => {
    setup({ week: week({ lossStreak: 0 }) });
    expect(screen.queryByText(/streak/)).toBeNull();
  });

  it("shows Rep scrims as a bar with its number and Cancelaciones, from the week's data", () => {
    setup({ week: week({ reputation: 25, cancellations: 1 }) });
    const rep = screen.getByRole("meter", { name: "Scrim rep" });
    expect(rep).toHaveAttribute("aria-valuenow", "25");
    expect(rep).toHaveAttribute("aria-valuetext", "25");
    expect(screen.getByText("Scrim rep")).toBeInTheDocument();
    expect(within(rep.parentElement as HTMLElement).getByText("25")).toBeInTheDocument();
    expect(screen.getByText("Cancellations").nextSibling).toHaveTextContent("1");
  });

  it("puts the staff suggestions under their own subheading, and nothing when there are none", () => {
    const { unmount } = setup();
    expect(screen.getByRole("heading", { level: 3, name: "Staff suggestions" })).toBeInTheDocument();
    expect(screen.getByText("Add fallbacks when rivals have better rep.")).toBeInTheDocument();
    unmount();
    setup({ suggestions: [] });
    expect(screen.queryByText("Staff suggestions")).toBeNull();
  });
});

describe("ScrimReportPane the most recent block", () => {
  it("is one medium matchup: the rival's logo with its name under it, a small result badge and the result word", () => {
    const { container } = setup();
    const card = block(container);
    expect(card).toHaveAccessibleName("Block review Wed A");
    expect(within(card).getByRole("img", { name: "MVK Esports" })).toBeInTheDocument();
    expect(within(card).getByText("MVK Esports")).toBeInTheDocument();
    const badge = card.querySelector('[data-slot="report-badge"]') as HTMLElement;
    expect(badge).toHaveAttribute("data-result", "lost");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge).toHaveTextContent("L");
    expect(within(card).getByText("Loss")).toBeInTheDocument();
    expect(within(card).getByText("Wed A")).toBeInTheDocument();
  });

  it("says the report's quality as a bar with its number, its focus and the detected issue in the game's words", () => {
    const { container } = setup();
    const card = block(container);
    const quality = within(card).getByRole("meter", { name: "Quality" });
    expect(quality).toHaveAttribute("aria-valuenow", "68");
    expect(within(card).getByText("68")).toBeInTheDocument();
    expect(within(card).getByText("Report focus").nextSibling).toHaveTextContent("Fix early game");
    expect(within(card).getByText("Detected issue").nextSibling).toHaveTextContent("Lane pressure");
  });

  it("shows only the newest report, not a list", () => {
    const { container } = setup();
    expect(block(container)).not.toHaveTextContent("GAM Esports");
    expect(screen.queryByRole("heading", { name: "Recent Reports" })).toBeNull();
    expect(container.querySelectorAll('[data-slot="report-block"]')).toHaveLength(1);
  });

  it("says a win with its word and a green letter, and leaves the issue out when there is none", () => {
    const { container } = setup({ week: week({ latestReports: [makeReport({ slot_index: 1, won: true, opponent_team_id: "gam", quality: 64, issue: null })] }) });
    const card = block(container);
    expect(within(card).getByText("Win")).toBeInTheDocument();
    expect(card.querySelector('[data-slot="report-badge"]')).toHaveAttribute("data-result", "won");
    expect(within(card).getByText("GAM Esports")).toBeInTheDocument();
    expect(within(card).getByText("Wed B")).toBeInTheDocument();
    expect(within(card).queryByText("Detected issue")).toBeNull();
  });

  it("skips a cancelled block: it has no result to show", () => {
    const { container } = setup({
      week: week({ latestReports: [makeReport({ slot_index: 1, status: "Cancelled", won: null, opponent_team_id: "gam" }), makeReport({ won: false, quality: 68 })] }),
    });
    expect(within(block(container)).getByText("MVK Esports")).toBeInTheDocument();
    expect(block(container)).not.toHaveTextContent("GAM Esports");
  });

  it("falls back to the team's name from the map when the team is unknown", () => {
    const { container } = setup({ teams: [], week: week({ latestReports: [makeReport({ opponent_team_id: "mvk" })] }) });
    expect(within(block(container)).getByText("MVK Esports")).toBeInTheDocument();
  });
});

describe("ScrimReportPane with no reports yet", () => {
  it("says so with the existing strings and still shows the record, Rep scrims and Cancelaciones", () => {
    const { container } = setup({ week: emptyWeek() });
    expect(block(container)).toBeNull();
    expect(screen.getByText("No recent reports")).toBeInTheDocument();
    expect(screen.getByText("Complete scrims to generate the weekly summary.")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="report-record"]')).toHaveTextContent("0-0");
    expect(screen.getByRole("meter", { name: "Scrim rep" })).toBeInTheDocument();
    expect(screen.getByText("Cancellations").nextSibling).toHaveTextContent("0");
  });
});
