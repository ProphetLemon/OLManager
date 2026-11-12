import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SoloQDayKind, SoloQDecayMode, SoloQDecayPreset, SoloQHistory, SoloQHistoryDay } from "@/api/types";
import { translateFromEnglish as t } from "@/test-i18n";
import SoloqLadderCardV2 from "./SoloqLadderCardV2";
import type { SoloqHistoryState } from "./useSoloqHistory";

const RESET = "MentalResetRecovery";
const FIRST = Date.UTC(2026, 1, 1);
const iso = (index: number) => new Date(FIRST + index * 86_400_000).toISOString().slice(0, 10);
const shortDate = (index: number) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(FIRST + index * 86_400_000));

const PRESETS: SoloQDecayPreset[] = [
  { mode: "Off", decay_per_idle_day: 0, bank_days: 0, recovery_per_played_day: 0 },
  { mode: "Soft", decay_per_idle_day: 25, bank_days: 21, recovery_per_played_day: 50 },
  { mode: "Real", decay_per_idle_day: 50, bank_days: 14, recovery_per_played_day: 100 },
  { mode: "Harsh", decay_per_idle_day: 75, bank_days: 7, recovery_per_played_day: 150 },
];

/**
 * 90 days under Real: a Mental Reset spell on days 30-35 (inside the grace period), then 20 days with
 * no team (days 50-69): 14 grace days, then 6 decay days of 50 LP, and a full recovery by the end.
 */
function ninety(): SoloQHistoryDay[] {
  const days: SoloQHistoryDay[] = [];
  let bank = 14;
  let offset = 0;
  for (let i = 0; i < 90; i += 1) {
    const formula = 1000 + (i % 7) * 10;
    let kind: SoloQDayKind = "Played";
    let focus: string | null = "Scrims";
    if (i >= 30 && i < 36) {
      kind = "Idle";
      focus = RESET;
    } else if (i >= 50 && i < 70) {
      kind = "Idle";
      focus = null;
    } else if (i % 7 === 6) kind = "Match";
    else if (i % 7 === 3) kind = "Rest";

    if (kind === "Played") {
      bank = Math.min(14, bank + 1);
      offset = Math.max(0, offset - 100);
    } else if (kind === "Idle") {
      if (bank > 0) bank -= 1;
      else {
        offset = Math.min(offset + 50, formula);
        kind = "Decay";
      }
    }
    days.push({ date: iso(i), lp: Math.max(0, formula - offset), formula_lp: formula, focus, kind, bank, bank_max: 14 });
  }
  return days;
}

function ready(days: SoloQHistoryDay[], over: Partial<SoloQHistory> = {}, mode: SoloQDecayMode = "Real"): SoloqHistoryState {
  const last = days[days.length - 1];
  return {
    status: "ready",
    presets: PRESETS,
    history: {
      player_id: "p1",
      followed: true,
      decay_mode: mode,
      bank_days: last?.bank ?? 14,
      bank_max: 14,
      offset_lp: last ? Math.max(0, last.formula_lp - last.lp) : 0,
      days,
      ...over,
    },
  };
}

function renderCard(state: SoloqHistoryState, extra: Partial<React.ComponentProps<typeof SoloqLadderCardV2>> = {}) {
  return render(<SoloqLadderCardV2 state={state} language="en" t={t} {...extra} />);
}

const hint = () => screen.getByText(/^Day \d+ of \d+/).textContent;

describe("SoloqLadderCardV2 story and ranges", () => {
  it("writes the story sentence from the whole history", () => {
    renderCard(ready(ninety()));
    expect(
      screen.getByText("26 idle days on Mental Reset or without a team cost up to 300 LP."),
    ).toBeInTheDocument();
    expect(screen.getByText("All of it has been won back.")).toBeInTheDocument();
  });

  it("offers 30, 60 and 90 days and rewrites the story for the one picked", () => {
    renderCard(ready(ninety()));
    const group = screen.getByRole("radiogroup", { name: "Time range" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["30 days", "60 days", "90 days"]);
    expect(within(group).getByRole("radio", { name: "90 days" })).toBeChecked();

    fireEvent.click(within(group).getByRole("radio", { name: "30 days" }));

    expect(screen.getByText("10 idle days without a team cost up to 300 LP.")).toBeInTheDocument();
    expect(screen.getByText("Peak, last 30 days")).toBeInTheDocument();
    expect(hint()).toBe("Day 30 of 30, today");
  });

  it("hides the range choice when the whole history is a single option, and says it began", () => {
    renderCard(ready(ninety().slice(-21)));
    expect(screen.queryByRole("radiogroup", { name: "Time range" })).not.toBeInTheDocument();
    expect(screen.getByText("Change in 20 days")).toBeInTheDocument();
    expect(screen.getByText(`Since ${shortDate(69)}, when history began`)).toBeInTheDocument();
    expect(hint()).toBe("Day 21 of 21, today");
  });
});

describe("SoloqLadderCardV2 day inspector", () => {
  it("steps back and forward one day and returns to today", () => {
    renderCard(ready(ninety()));
    const prev = screen.getByRole("button", { name: "Previous day" });
    const next = screen.getByRole("button", { name: "Next day" });
    const today = screen.getByRole("button", { name: "Today" });
    expect(hint()).toBe("Day 90 of 90, today");
    expect(next).toBeDisabled();
    expect(today).toBeDisabled();

    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(hint()).toBe("Day 88 of 90");
    expect(next).toBeEnabled();
    expect(today).toBeEnabled();

    fireEvent.click(next);
    expect(hint()).toBe("Day 89 of 90");

    fireEvent.click(today);
    expect(hint()).toBe("Day 90 of 90, today");
  });

  it("cannot step before the first day of the range", () => {
    renderCard(ready(ninety()));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(hint()).toBe("Day 1 of 90");
    expect(screen.getByRole("button", { name: "Previous day" })).toBeDisabled();
  });

  it("maps a click anywhere on the plot to the nearest day with one overlay", () => {
    renderCard(ready(ninety()));
    const overlay = screen.getByTestId("soloq-chart-overlay");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 100, width: 750, top: 0, height: 100, right: 850, bottom: 100, x: 100, y: 0, toJSON: () => ({}) });

    fireEvent.click(overlay, { clientX: 100 });
    expect(hint()).toBe("Day 1 of 90");
    fireEvent.click(overlay, { clientX: 850 });
    expect(hint()).toBe("Day 90 of 90, today");
    fireEvent.mouseMove(overlay, { clientX: 475 });
    expect(hint()).toBe("Day 46 of 90");
  });

  it("keeps the overlay mapping when the range is narrower", () => {
    renderCard(ready(ninety()));
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
    const overlay = screen.getByTestId("soloq-chart-overlay");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, width: 600, top: 0, height: 100, right: 600, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(overlay, { clientX: 0 });
    expect(hint()).toBe("Day 1 of 30");
  });

  it("shows the hidden offset and the cause on a decay day without hard-coding Mental Reset", () => {
    const days = ninety();
    const firstDecay = days.findIndex((entry) => entry.kind === "Decay");
    renderCard(ready(days));

    fireEvent.change(screen.getByRole("slider"), { target: { value: String(firstDecay) } });

    const group = screen.getByRole("group", { name: "Selected day" });
    expect(within(group).getByText("Idle (no team), grace period used up. Lost 50 LP.")).toBeInTheDocument();
    expect(within(group).getByText("Hidden offset")).toBeInTheDocument();
    expect(within(group).getByText("−50 LP")).toBeInTheDocument();
    expect(within(group).getByText("No team")).toBeInTheDocument();
  });

  it("names Mental Reset as the cause on a reset day", () => {
    renderCard(ready(ninety()));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "31" } });
    const group = screen.getByRole("group", { name: "Selected day" });
    expect(within(group).getByText(/^Idle \(mental reset\), grace day/)).toBeInTheDocument();
    expect(within(group).getByText("Mental Reset")).toBeInTheDocument();
  });

  it("tells a match day what happened when the player played it", () => {
    const days = ninety();
    const matchIndex = days.findIndex((entry) => entry.kind === "Match");
    renderCard(ready(days), { matchesByDate: new Map([[days[matchIndex].date, { opponent: "Atlas Gaming", won: true, kda: "6/1/9" }]]) });
    fireEvent.change(screen.getByRole("slider"), { target: { value: String(matchIndex) } });
    expect(screen.getByText("Won vs Atlas Gaming, 6/1/9")).toBeInTheDocument();
  });
});

describe("SoloqLadderCardV2 table", () => {
  it("shows the same record as text with the Focus column and the hidden offset", () => {
    const days = ninety();
    renderCard(ready(days));
    const toggle = screen.getByRole("button", { name: "Show as table" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Hide table" })).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByRole("table", { name: "Daily LP" });
    const headers = within(table).getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual(["Date", "Focus", "Day", "Grace", "Offset", "Formula LP", "With decay"]);

    const rowFor = (index: number) => within(table).getAllByRole("row").find((row) => within(row).queryByText(shortDate(index)) !== null) as HTMLElement;
    const noTeam = within(rowFor(55)).getAllByRole("cell").map((cell) => cell.textContent);
    expect(noTeam[1]).toBe("No team");
    expect(noTeam[2]).toBe("Idle, grace day (no team)");
    const reset = within(rowFor(31)).getAllByRole("cell").map((cell) => cell.textContent);
    expect(reset[1]).toBe("Mental Reset");
    expect(reset[2]).toBe("Idle, grace day (mental reset)");
    const firstDecay = days.findIndex((entry) => entry.kind === "Decay");
    const decay = within(rowFor(firstDecay)).getAllByRole("cell").map((cell) => cell.textContent);
    expect(decay[2]).toBe("Decay day (no team)");
    expect(decay[4]).toBe("−50");
    expect(decay[3]).toBe("0 of 14");
  });

  it("lists the newest day first", () => {
    renderCard(ready(ninety()));
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const rows = within(screen.getByRole("table", { name: "Daily LP" })).getAllByRole("row");
    expect(within(rows[1]).getByText(shortDate(89))).toBeInTheDocument();
  });
});

describe("SoloqLadderCardV2 decay modes", () => {
  it("explains that decay is off, and shows neither the offset nor the formula line", () => {
    const days = ninety().map((entry) => ({ ...entry, lp: entry.formula_lp, bank: 0 }));
    renderCard(ready(days, { bank_days: 0, bank_max: 0 }, "Off"));
    expect(screen.getByText(/Inactivity decay: Off\./)).toBeInTheDocument();
    expect(screen.getByText("Off. LP follows the formula every day.")).toBeInTheDocument();
    expect(screen.queryByText("Hidden offset")).not.toBeInTheDocument();
    expect(screen.queryByText("Formula LP, no decay")).not.toBeInTheDocument();
    expect(screen.getByText("Idle day")).toBeInTheDocument();
    expect(screen.getByText(/^Decay is off\. 26 idle days on Mental Reset or without a team cost no extra LP\./)).toBeInTheDocument();
  });

  it("shows a read-only status and a link to Settings", () => {
    renderCard(ready(ninety()));
    expect(
      screen.getByText("Inactivity decay: Real. It is set in Settings and applies to every player in this save."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change it in Settings" })).toHaveAttribute("href", "/settings");
  });

  it("opens Settings from inside the app, remembering where to come back to", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<SoloqLadderCardV2 state={ready(ninety())} language="en" t={t} />} />
          <Route path="/settings" element={<p>Settings page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change it in Settings" }));
    expect(screen.getByText("Settings page")).toBeInTheDocument();
  });
});

describe("SoloqLadderCardV2 empty states", () => {
  it("says there is no history, why, and offers the scout action", () => {
    renderCard(ready([], { followed: false, bank_days: 14, bank_max: 14, offset_lp: 0 }), {
      scoutAction: <button type="button">Scout</button>,
    });
    expect(screen.getByText("No LP history yet")).toBeInTheDocument();
    expect(screen.getByText(/History starts when the player joins your club or you scout the player\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scout" })).toBeInTheDocument();
    expect(screen.getByText("Grace period 14 of 14 days. No LP held back by decay.")).toBeInTheDocument();
    expect(screen.getByText("History is kept for your roster and players you scout, for the last 90 days.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("reports what is held back while the history is empty", () => {
    renderCard(ready([], { followed: false, bank_days: 0, bank_max: 14, offset_lp: 250 }));
    expect(screen.getByText("Grace period 0 of 14 days. 250 LP held back by decay.")).toBeInTheDocument();
  });

  it("tells a followed player that the first point is coming", () => {
    renderCard(ready([], { followed: true }), { scoutAction: <button type="button">Scout</button> });
    expect(screen.getByText("History has started")).toBeInTheDocument();
    expect(screen.getByText(/The first point appears after the next day\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scout" })).not.toBeInTheDocument();
  });

  it("draws nothing while loading or when the history cannot be read", () => {
    const { container, rerender } = renderCard({ status: "loading" });
    expect(container).toBeEmptyDOMElement();
    rerender(<SoloqLadderCardV2 state={{ status: "unavailable" }} language="en" t={t} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SoloqLadderCardV2 at the floor", () => {
  it("reads Master 0 LP instead of unranked, in the numbers, the readout and the chart", () => {
    const days = ninety();
    days[88] = { ...days[88], kind: "Decay", focus: null, lp: 0, formula_lp: 520, bank: 0 };
    days[89] = { ...days[89], kind: "Decay", focus: null, lp: 0, formula_lp: 520, bank: 0 };
    renderCard(ready(days));

    const group = screen.getByRole("group", { name: "Selected day" });
    expect(within(group).getByText("Master 0 LP")).toBeInTheDocument();
    expect(within(group).getByText("−520 LP")).toBeInTheDocument();
    expect(within(group).getByText("Capped at the floor")).toBeInTheDocument();
    expect(screen.getByText("Floor: Master 0 LP")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Now Master 0 LP\./ })).toBeInTheDocument();
    expect(screen.queryByText(/unranked/i)).not.toBeInTheDocument();
  });

  it("names the tier lines in the chart", () => {
    renderCard(ready(ninety()));
    expect(screen.getByText("Grandmaster from 800 LP")).toBeInTheDocument();
    expect(screen.getByText("Challenger from 1,300 LP")).toBeInTheDocument();
  });
});

describe("SoloqLadderCardV2 legend", () => {
  it("lists the day kinds with their shapes", () => {
    renderCard(ready(ninety()));
    const legend = screen.getByRole("list", { name: "Chart legend" });
    for (const label of ["SoloQ day", "Idle, grace day", "Decay day", "Match day, no change", "Rest day, no change"]) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
    expect(legend.querySelectorAll("svg path").length).toBeGreaterThanOrEqual(5);
  });
});
