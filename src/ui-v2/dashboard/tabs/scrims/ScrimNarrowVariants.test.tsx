import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { dayStateKey } from "@/lib/scrims/scrimDesk";
import type { ScrimReportData } from "@/store/gameStore";
import "@/i18n";
import { CostMark } from "./EffectText";
import { ScrimDecisionFacts } from "./ScrimDecisionFacts";
import { ScrimDecisionResult } from "./ScrimDecisionResult";
import { ScrimRecentReports } from "./ScrimWeeklyReport";
import { ScrimStaffSuggestions } from "./ScrimStaffSuggestions";
import { ScrimTag } from "./ScrimTag";

const report = {
  date: "2026-01-06",
  week_key: "w1",
  slot_index: 0,
  weekday: 2,
  team_id: "me",
  opponent_team_id: "mvk",
  status: "Played",
  won: false,
  focus: "EarlyGame",
  issue: "LanePressure",
  severity: 3,
  quality: 61,
  player_champion_picks: [],
  post_decision: null,
  created_on: "2026-01-06",
} as unknown as ScrimReportData;

describe("shared pieces that have a narrow form", () => {
  it("words the state of the day with the keys the badge uses", () => {
    expect(dayStateKey("Planned")).toBe("scrims.planned");
    expect(dayStateKey("PlayedNeedsReview")).toBe("scrims.pendingReview");
    expect(dayStateKey("Reviewed")).toBe("scrims.reviewed");
    expect(dayStateKey("Cancelled")).toBe("scrims.cancelled");
    expect(dayStateKey("NoScrimToday")).toBe("scrims.noScrim");
    expect(dayStateKey("Confirmed")).toBe("scrims.noScrim");
  });

  it("draws the cost mark with its word", () => {
    render(<CostMark />);
    expect(screen.getByText("Cost")).toBeInTheDocument();
  });

  it("keeps the facts bar's content in the compact form, and the issue only after a loss", () => {
    const { rerender, container } = render(<ScrimDecisionFacts report={report} slotLabel="Wed A" blockLabel="A" compact />);
    const facts = container.querySelector('[data-slot="scrim-decision-facts"]') as HTMLElement;
    for (const text of ["Loss", "Wed A", "Report focus", "Fix early game", "Quality", "61", "Detected issue", "A of 2"]) {
      expect(within(facts).getAllByText(text).length).toBeGreaterThan(0);
    }
    rerender(<ScrimDecisionFacts report={{ ...report, won: true, issue: null }} slotLabel="Wed A" blockLabel={null} compact />);
    expect(screen.queryByText("Detected issue")).toBeNull();
    expect(screen.queryByText("Block")).toBeNull();
    expect(screen.getAllByText("Win").length).toBeGreaterThan(0);
  });

  it("writes a tag as plain text with its benefit or cost word", () => {
    const { container } = render(<ScrimTag tag="fatiguePlus" plain />);
    expect(container.textContent).toContain("+Fatigue");
    expect(container.textContent).toContain("cost");
    expect(container.querySelector("[class*='border']")).toBeNull();
  });

  it("draws the staff suggestions bare, as an h3 with no card", () => {
    render(<ScrimStaffSuggestions suggestions={["Add a fallback."]} bare />);
    expect(screen.getByRole("heading", { level: 3, name: "Staff suggestions" })).toBeInTheDocument();
  });

  it("lists recent reports with the rival's name", () => {
    render(<ScrimRecentReports reports={[report]} teamNameById={new Map([["mvk", "MVK Esports"]])} />);
    expect(screen.getByText("MVK Esports")).toBeInTheDocument();
    expect(screen.getByText("Q61")).toBeInTheDocument();
  });

  it("draws the result compactly: the pane's heading sits between the live line and the rows", () => {
    const { container } = render(
      <ScrimDecisionResult
        compact
        statusText="Decision applied to scrim block: Push through"
        heading={<h2>What changed</h2>}
        result={{
          action: "PushThrough",
          closing: "blockTwoPlayed",
          rows: [{ kind: "change", field: "quality", before: 61, after: 73, cost: false }],
        }}
      />,
    );
    const live = container.querySelector("[aria-live]") as HTMLElement;
    const heading = screen.getByRole("heading", { name: "What changed" });
    expect(live.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});
