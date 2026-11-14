import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { buildScoreboard, keyEventsOf } from "@/lib/match/live/postGame";
import { buildTimeline } from "@/lib/match/live/postGameTimeline";
import { END_SEC, champions, finishedMatch, goldSamples, matchRecord } from "@/lib/match/live/postGameFixtures.testing";
import { teamIdentity } from "@/lib/match/live/teamIdentity";

import { PostGameGraphs } from "./PostGameGraphs";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const BLUE = teamIdentity("Shifters", [{ name: "Shifters", short_name: "SHI" }]);
const RED = teamIdentity("Movistar KOI", [{ name: "Movistar KOI", short_name: "MKOI" }]);
const PICKS = { "b-adc": "Jinx" };

function show(over: Parameters<typeof finishedMatch>[0] = {}) {
  const state = finishedMatch(over);
  const board = buildScoreboard(state);
  const roster = [...board.rows.blue, ...board.rows.red].map((row) => ({ id: row.id, name: row.name, team: row.side }));
  const entries = buildTimeline(keyEventsOf(state), { complete: state.matchRecord?.skippedAtSec === null, roster });
  return render(<PostGameGraphs board={board} record={state.matchRecord} entries={entries} blue={BLUE} red={RED} championByPlayerId={PICKS} />);
}

/** A skip at 2:00 that showed nothing until the last minutes. */
const skipped = () =>
  matchRecord({ skippedAtSec: 125, gold: [...goldSamples().slice(0, 3), ...goldSamples().slice(-2)] });

describe("the team gold difference chart", () => {
  it("draws one line for a match watched whole, and says nothing about a partial series", () => {
    show();
    expect(screen.getAllByTestId("gold-line")).toHaveLength(1);
    expect(screen.queryByTestId("gold-gap")).not.toBeInTheDocument();
    expect(screen.queryByText("Partial: match skipped")).not.toBeInTheDocument();
  });

  it("describes the chart in words: who ended ahead, each side's biggest lead, and nothing partial", () => {
    show();
    const chart = screen.getByTestId("gold-diff-chart");
    const summary = document.getElementById(chart.getAttribute("aria-describedby")!)!;
    expect(summary).toHaveTextContent("Team gold difference over the match.");
    expect(summary).toHaveTextContent("Shifters finished 8.2k ahead in gold");
    expect(summary).toHaveTextContent("Biggest lead for Shifters: 8.2k, at 31:48.");
    expect(summary).toHaveTextContent("Biggest lead for Movistar KOI: 150, at 1:01.");
    expect(summary).not.toHaveTextContent("partial");
  });

  it("breaks the line where a skip left minutes nobody saw, names the gap and says the series is partial", () => {
    show({ matchRecord: skipped() });
    // Two runs: the minutes watched, then the last two samples.
    expect(screen.getAllByTestId("gold-line")).toHaveLength(2);
    const gap = screen.getByTestId("gold-gap");
    expect(within(gap).getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByText("Partial: match skipped")).toBeInTheDocument();
    const summary = document.getElementById(screen.getByTestId("gold-diff-chart").getAttribute("aria-describedby")!)!;
    expect(summary).toHaveTextContent("This series is partial: the match was skipped and nothing was recorded from 2:01 to 31:01.");
  });

  it("has no chart, and says why, when the match recorded no gold", () => {
    show({ matchRecord: undefined });
    expect(screen.queryByTestId("gold-line")).not.toBeInTheDocument();
    expect(screen.getByText("The gold difference of this match was not recorded.")).toBeInTheDocument();
  });

  it("reads the chart minute by minute with a slider, for the keyboard and for screen readers", () => {
    show();
    const slider = screen.getByRole("slider", { name: "Gold difference, minute by minute" });
    const last = goldSamples().length - 1;
    expect(slider).toHaveAttribute("max", String(last));
    expect(slider).toHaveAttribute("aria-valuetext", "31:48: SHI ahead by 8.2k");
    fireEvent.change(slider, { target: { value: "1" } });
    expect(slider).toHaveAttribute("aria-valuetext", "1:01: MKOI ahead by 150");
    expect(screen.getByTestId("gold-diff-chart").querySelector(".pg-tip")).toHaveTextContent("1:01: MKOI ahead by 150");
  });

  it("swaps the picture for a table with every sample, and marks the gap in it", () => {
    show({ matchRecord: skipped() });
    const toggle = within(screen.getByTestId("gold-diff-chart")).getByRole("button", { name: "Table" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table", { name: "Gold difference by minute" });
    // Header, five samples and the row that names the gap.
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(within(table).getByText("Not recorded from 2:01 to 31:01")).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "31:48" })).toBeInTheDocument();
  });

  it("says in the table that each lead is gold, so a bare 28 is not a mystery", () => {
    show({ matchRecord: skipped() });
    fireEvent.click(within(screen.getByTestId("gold-diff-chart")).getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Gold difference by minute" });
    const cells = within(table).getAllByRole("cell").map((cell) => cell.textContent ?? "");
    const leads = cells.filter((text) => /ahead/.test(text));
    expect(leads.length).toBeGreaterThan(0);
    for (const text of leads) expect(text, text).toMatch(/ahead by [\d.,]+k? gold$/);
  });

  it("marks objectives and structures on the time axis, each with its time and sentence", () => {
    show();
    const rail = screen.getByRole("group", { name: "Objectives and structures, in time order" });
    const markers = within(rail).getAllByRole("img");
    expect(markers.length).toBeGreaterThanOrEqual(8);
    expect(within(rail).getByRole("img", { name: /^7:08, / })).toBeInTheDocument();
    // The last turrets and the nexus are one counted marker.
    expect(within(rail).getByRole("img", { name: /3 structures/ })).toBeInTheDocument();
    expect(markers.every((marker) => marker.querySelector("img")?.getAttribute("src")?.startsWith("/lol-map-icons/"))).toBe(true);
  });

  it("labels the end of the axis with the real end of the match", () => {
    show();
    const axis = screen.getByTestId("gold-diff-chart").querySelector(".pg-xax")!;
    expect(axis).toHaveTextContent("31:48");
    expect(END_SEC).toBe(1908);
  });
});

describe("the damage and gold charts", () => {
  it("shows a bar for each of the ten players, grouped by team and sorted, with the portrait, value and share", () => {
    show();
    const chart = screen.getByTestId("damage-chart");
    const rows = within(chart).getAllByRole("img", { name: /of the team$/ });
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveAccessibleName("Paduck: 34.7k, 36% of the team");
    expect(rows[0].querySelector("img")).toHaveAttribute("src", "/champion-tiles/Jinx.webp");
    expect(within(chart).getByRole("group", { name: "Shifters, 96.0k" })).toBeInTheDocument();
  });

  it("describes each chart in words: both totals and the highest player", () => {
    show();
    const chart = screen.getByTestId("damage-chart");
    const summary = document.getElementById(chart.getAttribute("aria-describedby")!)!;
    expect(summary).toHaveTextContent("Damage to champions per player.");
    expect(summary).toHaveTextContent("Shifters: 96.0k in total.");
    expect(summary).toHaveTextContent("Movistar KOI: 75.0k.");
    expect(summary).toHaveTextContent("Highest: Paduck, 34.7k.");
  });

  it("offers the same numbers as a table, with the gold at ten and twenty minutes for the gold chart", () => {
    show();
    const panel = screen.getByTestId("gold-chart");
    fireEvent.click(within(panel).getByRole("button", { name: "Table" }));
    const table = within(panel).getByRole("table", { name: "Gold earned, values" });
    expect(within(table).getByRole("columnheader", { name: "Gold at 10:00" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Gold at 20:00" })).toBeInTheDocument();
    const row = within(table).getByRole("row", { name: /Paduck/ });
    // 24.6k earned in all, 8.5k of it by the tenth minute, as recorded.
    expect(within(row).getByText("24.6k")).toBeInTheDocument();
    expect(within(row).getByText("8.5k")).toBeInTheDocument();
    expect(within(row).getByText("25%")).toBeInTheDocument();
  });

  it("leaves a gold-at column out when a skip hid that minute, instead of a column of dashes", () => {
    show({ matchRecord: skipped() });
    const panel = screen.getByTestId("gold-chart");
    fireEvent.click(within(panel).getByRole("button", { name: "Table" }));
    expect(within(panel).queryByRole("columnheader", { name: "Gold at 10:00" })).not.toBeInTheDocument();
  });

  it("leaves the damage chart out, and says so, when the engine did not send damage", () => {
    show({ champions: champions({ damageDealt: undefined }) });
    expect(screen.queryByTestId("damage-chart")).not.toBeInTheDocument();
    expect(screen.getByText("The engine did not send damage for this match, so there is no damage chart.")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /of the team$/ })).toHaveLength(10);
  });
});
