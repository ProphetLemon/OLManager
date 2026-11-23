import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { dayStateKey } from "@/lib/scrims/scrimDesk";
import type { ScrimReportData } from "@/store/gameStore";
import "@/i18n";
import { CostMark } from "./EffectText";
import { ScrimRecentReports } from "./ScrimWeeklyReport";
import { ScrimStaffSuggestions } from "./ScrimStaffSuggestions";

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

describe("shared pieces the phone views reuse", () => {
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

  it("draws the staff suggestions bare, as an h3 with no card", () => {
    render(<ScrimStaffSuggestions suggestions={["Add a fallback."]} bare />);
    expect(screen.getByRole("heading", { level: 3, name: "Staff suggestions" })).toBeInTheDocument();
  });

  it("lists recent reports with the rival's name", () => {
    render(<ScrimRecentReports reports={[report]} teamNameById={new Map([["mvk", "MVK Esports"]])} />);
    expect(screen.getByText("MVK Esports")).toBeInTheDocument();
    expect(screen.getByText("Q61")).toBeInTheDocument();
  });
});
