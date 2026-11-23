import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import i18n from "@/i18n";
import { autofillPlans } from "@/lib/scrims/scrimPlans";
import type { ScrimContextResponse, TodayScrimContext, WeeklyScrimContext, WeeklyScrimSlotContext } from "@/lib/scrims/scrimContext";
import type { GameStateData, ScrimReportData, TeamData } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";

const appCss = readFileSync("src/App.css", "utf8");

// The whole file runs as a phone: the tab reads the user agent while it renders.
vi.hoisted(() => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const trainingMocks = vi.hoisted(() => ({
  chooseDailyScrimAction: vi.fn(),
  setWeeklyScrimObjective: vi.fn(),
  setWeeklyScrimSlots: vi.fn(),
  setWeeklyScrimPlans: vi.fn(),
  finalizeWeeklyScrimSetup: vi.fn(),
}));
vi.mock("@/services/trainingService", () => ({ ...trainingMocks, getScrimContext: vi.fn() }));

const contextMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useScrimContextWithFallback", () => ({ useScrimContextWithFallback: () => contextMock.current }));

import { ScrimsTabV2 } from "./ScrimsTabV2";

const RIVALS = ["alpha", "bravo", "charlie", "delta"];

function team(id: string, name: string, over: Partial<TeamData> = {}): TeamData {
  return {
    id,
    name,
    short_name: name.slice(0, 3).toUpperCase(),
    country: "ES",
    colors: { primary: "#000", secondary: "#fff" },
    starting_xi_ids: [],
    form: [],
    history: [],
    competition_id: "lec",
    scrim_reputation: 50,
    scrim_weekly_slots: 4,
    ...over,
  } as unknown as TeamData;
}

function game(over: Partial<GameStateData> = {}): GameStateData {
  return {
    manager: { team_id: "mine" },
    teams: [team("mine", "Mine"), ...RIVALS.map((id) => team(id, id[0].toUpperCase() + id.slice(1)))],
    players: [],
    clock: { current_date: "2026-04-29", start_date: "2026-01-01T12:00:00Z" },
    day_phase: "Morning",
    ...over,
  } as unknown as GameStateData;
}

const DAYS = [2, 2, 3, 3];
function slot(index: number, over: Partial<WeeklyScrimSlotContext> = {}): WeeklyScrimSlotContext {
  return {
    slotIndex: index,
    weekday: DAYS[index],
    label: "x",
    labelDay: DAYS[index],
    labelSuffix: index % 2 === 0 ? "A" : "B",
    plan: [],
    resolvedOpponentTeamId: null,
    resultWon: null,
    report: null,
    status: "Open",
    canEdit: true,
    ...over,
  };
}

function report(over: Partial<ScrimReportData> = {}): ScrimReportData {
  return {
    date: "2026-04-29",
    week_key: "2026-W18",
    slot_index: 0,
    weekday: 2,
    team_id: "mine",
    opponent_team_id: "alpha",
    status: "Played",
    won: false,
    focus: "EarlyGame",
    issue: "LanePressure",
    severity: 2,
    quality: 61,
    player_champion_picks: [],
    post_decision: null,
    created_on: "2026-04-29",
    ...over,
  } as ScrimReportData;
}

function today(over: Partial<TodayScrimContext> = {}): TodayScrimContext {
  return {
    state: "Idle",
    slotIndex: null,
    opponentTeamId: null,
    resolvedOpponentTeamId: null,
    objective: null,
    report: null,
    canEditPlan: false,
    canCancel: false,
    canReview: false,
    canViewWeeklyPlan: true,
    hasOfficialMatch: false,
    primaryAction: "Training",
    pushThroughRecommended: false,
    ...over,
  } as TodayScrimContext;
}

function week(over: Partial<WeeklyScrimContext> = {}): WeeklyScrimContext {
  return {
    weekKey: "2026-W18",
    objective: null,
    capacity: 4,
    planned: 0,
    reputation: 50,
    cancellations: 0,
    played: 0,
    wins: 0,
    losses: 0,
    lossStreak: 0,
    avgQuality: 0,
    topFocus: null,
    topIssue: null,
    nextOfficialRivalTeamId: null,
    nextOfficialRivalCompetition: null,
    setupLocked: false,
    setupLockedReason: null,
    canFinalizeSetup: true,
    slots: [slot(0), slot(1), slot(2), slot(3)],
    latestReports: [],
    ...over,
  } as WeeklyScrimContext;
}

const ctx = (w: WeeklyScrimContext, t: TodayScrimContext): ScrimContextResponse => ({ week: w, today: t }) as ScrimContextResponse;

/** Monday: a fresh week, nothing set. */
const monday = () => ctx(week(), today());
/** Monday with the objective set and Wed A planned: Next points at Wed B. */
const planning = () =>
  ctx(week({ objective: "Macro", planned: 1, slots: [slot(0, { plan: ["alpha"] }), slot(1), slot(2), slot(3)] }), today());
/** Wednesday after block A, lost: Wed A waits for a decision. */
const afterBlockA = () =>
  ctx(
    week({
      setupLocked: true,
      setupLockedReason: "week_started",
      objective: "Macro",
      planned: 4,
      played: 1,
      losses: 1,
      slots: [
        slot(0, { plan: ["alpha"], status: "Played", canEdit: false, resolvedOpponentTeamId: "alpha", resultWon: false, report: report() }),
        slot(1, { plan: ["bravo"], status: "Locked", canEdit: false }),
        slot(2, { plan: ["charlie"], status: "Locked", canEdit: false }),
        slot(3, { plan: ["delta"], status: "Locked", canEdit: false }),
      ],
      latestReports: [report()],
    }),
    today({ state: "PlayedNeedsReview", slotIndex: 0, opponentTeamId: "alpha", report: report(), canReview: true }),
  );
/** Wednesday morning of a finalized week: Wed A is today's block. */
const scrimMorning = () =>
  ctx(
    week({
      setupLocked: true,
      setupLockedReason: "manual",
      objective: "Macro",
      planned: 4,
      slots: [
        slot(0, { plan: ["alpha", "bravo"], status: "Locked", canEdit: false }),
        slot(1, { plan: ["bravo"], status: "Locked", canEdit: false }),
        slot(2, { plan: ["charlie"], status: "Locked", canEdit: false }),
        slot(3, { plan: ["delta"], status: "Locked", canEdit: false }),
      ],
    }),
    today({ state: "Planned", slotIndex: 0, opponentTeamId: "alpha", resolvedOpponentTeamId: "alpha", canEditPlan: true }),
  );
/** Block A decided with Push through; block B was played and waits. */
const afterPushThrough = () => {
  const a = report({ post_decision: "PushThrough", quality: 73, severity: 1 });
  const b = report({ slot_index: 1, opponent_team_id: "bravo" });
  const c = afterBlockA();
  c.week.slots[0] = { ...c.week.slots[0], status: "Reviewed", report: a };
  c.week.slots[1] = { ...c.week.slots[1], status: "Played", resultWon: false, report: b, resolvedOpponentTeamId: "bravo" };
  return ctx(c.week, today({ state: "PlayedNeedsReview", slotIndex: 1, opponentTeamId: "bravo", report: b, canReview: true }));
};

function updatedAfterPush(): GameStateData {
  const base = game();
  const mine = base.teams.find((t) => t.id === "mine") as TeamData;
  mine.scrim_reports = [report({ post_decision: "PushThrough", quality: 73, severity: 1 }), report({ slot_index: 1, opponent_team_id: "bravo" })];
  return base;
}

const cell = (id: string) => document.querySelector(`[data-row-id="${id}"]`) as HTMLElement;
const pane = (name: string) => document.querySelector(`[data-slot="scrim-${name}-pane"]`);

function mount(context: ScrimContextResponse | null, state = game()) {
  contextMock.current = context;
  const onGameUpdate = vi.fn();
  const utils = render(<ScrimsTabV2 gameState={state} onGameUpdate={onGameUpdate} />);
  const swap = (next: ScrimContextResponse) => {
    contextMock.current = next;
    utils.rerender(<ScrimsTabV2 gameState={state} onGameUpdate={onGameUpdate} />);
  };
  return { ...utils, onGameUpdate, swap };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, scrim_review_mode: "manual" } });
});

afterEach(() => {
  contextMock.current = null;
});

describe("ScrimsTabV2 on a phone: the frame", () => {
  it("renders the list and one pane, filling its wrapper, and the CSS rule lets the wrapper go", () => {
    const { container } = mount(monday());
    expect(document.querySelector('[data-slot="phone-week-list"]')).not.toBeNull();
    // The wrapper that DashboardV2 renders carries the attribute (see DashboardV2.phoneFixed.test); the root only fills it.
    expect(container.firstElementChild).not.toHaveAttribute("data-phone-fixed");
    expect(container.firstElementChild?.className).toContain("h-full");
    expect(container.firstElementChild?.className).toContain("min-h-0");
    expect(appCss).toMatch(/\[data-form="phone"\] #main-content > \[data-phone-fixed\]/);
  });

  it("uses the specification's frame: 8 px margins and gap, 4 px on top, none under", () => {
    const { container } = mount(monday());
    const root = container.firstElementChild as HTMLElement;
    for (const token of ["px-2", "pt-1", "pb-0", "gap-2"]) expect(root.className.split(" ")).toContain(token);
    expect(root.className).toContain("grid-cols-[17rem_minmax(0,1fr)]");
  });

  it("gives the list rows of exactly 48 px and gauges of exactly 42 px, pinned to the bottom", () => {
    mount(monday());
    for (const id of ["objective", "volume", "slot:0"]) expect(cell(id).parentElement?.className).toContain("h-[var(--hit)]");
    const gauges = document.querySelector('[data-slot="phone-week-gauges"]') as HTMLElement;
    expect(gauges.className).toContain("h-[2.625rem]");
    expect(gauges.className).toContain("mt-auto");
  });

  it("lets every pane scroll inside itself as a safety net, and the slot pane has no padding around its grid", () => {
    mount(planning());
    const check = () => {
      const el = document.querySelector('[data-slot^="scrim-"][data-slot$="-pane"]') as HTMLElement;
      expect(el.className).toContain("overflow-y-auto");
      return el;
    };
    const editable = check();
    expect(editable.className).not.toMatch(/(^| )p-\d/);
    for (const id of ["objective", "volume", "report", "slot:0"]) {
      fireEvent.click(cell(id));
      check();
    }
  });

  it("keeps the early states: no team and loading", () => {
    mount(monday(), game({ manager: { team_id: "nobody" } } as Partial<GameStateData>));
    expect(screen.getByText(/No team assigned/)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="phone-week-list"]')).toBeNull();
  });
});

describe("ScrimsTabV2 on a phone: which pane a row shows", () => {
  it("opens on the objective on a fresh Monday, and the objective, volume and report rows show their panes", () => {
    mount(monday());
    expect(pane("objective")).not.toBeNull();
    fireEvent.click(cell("volume"));
    expect(pane("volume")).not.toBeNull();
    fireEvent.click(cell("report"));
    expect(pane("report")).not.toBeNull();
    fireEvent.click(cell("objective"));
    expect(pane("objective")).not.toBeNull();
  });

  it("opens on the slot that carries Next, an editable slot pane", () => {
    mount(planning());
    expect(cell("slot:1")).toHaveAttribute("aria-current", "true");
    expect(pane("slot")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Rivals by overall rating" })).toBeInTheDocument();
  });

  it("shows the decision pane when the block waits for its decision", () => {
    mount(afterBlockA());
    expect(cell("slot:0")).toHaveAttribute("aria-current", "true");
    expect(pane("decision")).not.toBeNull();
    expect(pane("decision")?.className).toContain("overflow-y-auto");
    expect(screen.getByRole("button", { name: /Push through/ })).toBeInTheDocument();
  });

  it("shows the today pane for today's block on a scrim-day morning, and a read-only slot pane for the others", () => {
    mount(scrimMorning());
    expect(cell("slot:0")).toHaveAttribute("aria-current", "true");
    expect(pane("today")).not.toBeNull();
    fireEvent.click(cell("slot:2"));
    expect(pane("today")).toBeNull();
    expect(pane("slot")).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Rivals by overall rating" })).toBeNull();
  });
});

describe("ScrimsTabV2 on a phone: what moves by itself", () => {
  it("follows the row that starts to carry Decide when a block was played", () => {
    const { swap } = mount(scrimMorning());
    expect(pane("today")).not.toBeNull();
    fireEvent.click(cell("report"));
    swap(afterBlockA());
    expect(cell("slot:0")).toHaveAttribute("aria-current", "true");
    expect(pane("decision")).not.toBeNull();
  });

  it("does not follow a Next tag that moves because of the manager's own picks", () => {
    const { swap } = mount(planning());
    fireEvent.click(cell("report"));
    swap(ctx(week({ objective: "Macro", planned: 2, slots: [slot(0, { plan: ["alpha"] }), slot(1, { plan: ["bravo"] }), slot(2), slot(3)] }), today()));
    expect(cell("report")).toHaveAttribute("aria-current", "true");
    expect(pane("report")).not.toBeNull();
  });

  it("opens the Volume row once after the objective is chosen", async () => {
    trainingMocks.setWeeklyScrimObjective.mockResolvedValue(game());
    mount(monday());
    fireEvent.click(screen.getByRole("button", { name: /Fix early game/ }));
    expect(pane("volume")).not.toBeNull();
    expect(trainingMocks.setWeeklyScrimObjective).toHaveBeenCalledWith("EarlyGame");
    await waitFor(() => expect(trainingMocks.setWeeklyScrimObjective).toHaveBeenCalledTimes(1));
  });

  it("goes where phoneDoneTarget says on Done, and names that destination on its second line", () => {
    mount(planning());
    const done = screen.getByRole("button", { name: /Done/ });
    // Wed B is open and has no Plan A: the next slot with no Plan A after it is Thu A.
    expect(done).toHaveTextContent("Thu A");
    fireEvent.click(done);
    expect(cell("slot:2")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Done/ })).toHaveTextContent("Thu B");
  });

  it("saves a rival pick at once through the shared plan code and moves the slot pane's own tab", async () => {
    trainingMocks.setWeeklyScrimPlans.mockResolvedValue(game());
    mount(planning());
    const grid = screen.getByRole("group", { name: "Rivals by overall rating" });
    fireEvent.click(within(grid).getAllByRole("button")[0]);
    await waitFor(() => expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledTimes(1));
    const saved = trainingMocks.setWeeklyScrimPlans.mock.calls[0][0] as string[][];
    expect(saved[1][0]).not.toBe("");
    expect(saved[0][0]).toBe("alpha");
    expect(cell("slot:1")).toHaveAttribute("aria-current", "true");
    expect(within(screen.getByRole("group", { name: "Opponent plans" })).getByRole("button", { name: /Plan B/ })).toHaveTextContent("Choosing");
  });
});

describe("ScrimsTabV2 on a phone: the cancel step", () => {
  it("opens the follow-up without calling the backend, marks the reputation gauge, and Back returns", async () => {
    mount(afterBlockA());
    expect(document.querySelector('[data-slot="scrim-rep-ghost"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cancel scrims/ }));
    expect(trainingMocks.chooseDailyScrimAction).not.toHaveBeenCalled();
    expect(pane("followup")).not.toBeNull();
    expect(document.querySelector('[data-slot="scrim-rep-ghost"]')).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(pane("followup")?.querySelector("[data-pane-heading]")));
    fireEvent.click(screen.getByRole("button", { name: /Back to block decision/ }));
    expect(pane("decision")).not.toBeNull();
    expect(document.querySelector('[data-slot="scrim-rep-ghost"]')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(pane("decision")?.querySelector("[data-pane-heading]")));
  });
});

describe("ScrimsTabV2 on a phone: after a decision", () => {
  async function decide() {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedAfterPush());
    const utils = mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    await waitFor(() => expect(pane("result")).not.toBeNull());
    return utils;
  }

  it("replaces the cards with the result, moves focus to its heading", async () => {
    await decide();
    expect(trainingMocks.chooseDailyScrimAction).toHaveBeenCalledWith(0, "PushThrough");
    expect(pane("decision")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(pane("result")?.querySelector("[data-pane-heading]")));
    expect(pane("result")?.querySelector("[aria-live]")).toBeNull();
    expect(pane("result")).toHaveTextContent("Decision applied to scrim block: Push through");
  });

  it("stays on the result when the tag moves to the block that waits, and Decide <slot> selects that block", async () => {
    const { swap } = await decide();
    swap(afterPushThrough());
    expect(cell("slot:1")).toHaveTextContent("Decide");
    expect(cell("slot:0")).toHaveAttribute("aria-current", "true");
    expect(pane("result")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Decide Wed B" }));
    expect(cell("slot:1")).toHaveAttribute("aria-current", "true");
    expect(pane("decision")).not.toBeNull();
  });
});

describe("ScrimsTabV2 on a phone: the same actions as desktop", () => {
  it("Autofill saves the dealt plans through the backend call desktop uses", async () => {
    trainingMocks.setWeeklyScrimPlans.mockResolvedValue(game());
    mount(planning());
    fireEvent.click(cell("volume"));
    fireEvent.click(screen.getByRole("button", { name: /Autofill/ }));
    await waitFor(() => expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledTimes(1));
    // Same deal as the desktop button: every rival, strongest first (equal here, so by name), into all four slots.
    expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledWith(autofillPlans(RIVALS, "Macro", 4));
  });

  it("Finalize setup calls the backend once", async () => {
    trainingMocks.finalizeWeeklyScrimSetup.mockResolvedValue(game());
    mount(planning());
    fireEvent.click(cell("volume"));
    fireEvent.click(screen.getByRole("button", { name: /Finalize setup/i }));
    await waitFor(() => expect(trainingMocks.finalizeWeeklyScrimSetup).toHaveBeenCalledTimes(1));
  });

  it("with the assistant on the panes are read-only and the volume pane says who handles scrims", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, scrim_review_mode: "assistant" } });
    mount(planning());
    fireEvent.click(cell("objective"));
    const choices = within(screen.getByRole("group", { name: "Weekly objective" })).getAllByRole("button");
    expect(choices.every((choice) => choice.getAttribute("aria-disabled") === "true")).toBe(true);
    fireEvent.click(choices[1]);
    expect(trainingMocks.setWeeklyScrimObjective).not.toHaveBeenCalled();
    fireEvent.click(cell("slot:1"));
    expect(screen.queryByRole("group", { name: "Rivals by overall rating" })).toBeNull();
    fireEvent.click(cell("volume"));
    expect(screen.getByText("Assistant is handling scrims")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Finalize setup/i })).toBeNull();
  });

  it("a locked week shows its sentence on the first line of the locked panes", () => {
    mount(ctx(week({ setupLocked: true, setupLockedReason: "manual", objective: "Macro", planned: 4, slots: [0, 1, 2, 3].map((i) => slot(i, { plan: ["alpha"], status: "Locked", canEdit: false })) }), today()));
    fireEvent.click(cell("objective"));
    expect(screen.getByText(/You confirmed this week's setup/)).toBeInTheDocument();
    fireEvent.click(cell("slot:0"));
    expect(screen.getByText(/You confirmed this week's setup/)).toBeInTheDocument();
  });

  it("career start: the list is shown read-only and its sentence is on screen", () => {
    mount(ctx(week({ setupLocked: true, setupLockedReason: "career_started_late", slots: [0, 1, 2, 3].map((i) => slot(i, { status: "Locked", canEdit: false })) }), today()));
    expect(document.querySelector('[data-slot="phone-week-list"]')).not.toBeNull();
    expect(screen.getByText(/Your career starts after this week's scrim days/)).toBeInTheDocument();
  });
});

describe("ScrimsTabV2 on a phone: the shared decision text map", () => {
  it("lives in lib/scrims and covers every decision", async () => {
    const { DECISION_TEXT_KEY } = await import("@/lib/scrims/decisionTextKey");
    expect(DECISION_TEXT_KEY.PushThrough).toBe("pushThrough");
    expect(Object.keys(DECISION_TEXT_KEY)).toHaveLength(8);
  });
});

describe("ScrimsTabV2 on a phone: focus after a move the player asked for", () => {
  it("moves focus to the new pane's heading after Done", async () => {
    mount(planning());
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    expect(cell("slot:2")).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(document.activeElement).toBe(pane("slot")?.querySelector("[data-pane-heading]")));
  });

  it("moves focus to the decision pane's heading after Decide <slot>", async () => {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedAfterPush());
    const { swap } = mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    await waitFor(() => expect(pane("result")).not.toBeNull());
    swap(afterPushThrough());
    fireEvent.click(screen.getByRole("button", { name: "Decide Wed B" }));
    await waitFor(() => expect(document.activeElement).toBe(pane("decision")?.querySelector("[data-pane-heading]")));
  });
});

describe("ScrimsTabV2 on a phone: the live line", () => {
  const liveRegions = () => [...document.querySelectorAll('[aria-live], [role="status"]')] as HTMLElement[];
  const holding = (text: string) => liveRegions().filter((el) => el.textContent?.includes(text));

  it("has one polite region mounted before any decision, and the result pane's own line is not live", async () => {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedAfterPush());
    mount(afterBlockA());
    const before = liveRegions();
    expect(before).toHaveLength(1);
    expect(before[0]).toHaveAttribute("aria-live", "polite");
    expect(before[0].textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    await waitFor(() => expect(pane("result")).not.toBeNull());
    // The same node, now holding the text once in the document's live regions.
    expect(liveRegions()[0]).toBe(before[0]);
    expect(holding("Push through")).toHaveLength(1);
    expect(pane("result")?.querySelector("[aria-live]")).toBeNull();
  });

  it("shows the result of the block the decision was taken on even if another row was tapped during the save", async () => {
    let resolve!: (state: GameStateData) => void;
    trainingMocks.chooseDailyScrimAction.mockReturnValue(new Promise<GameStateData>((done) => (resolve = done)));
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    fireEvent.click(cell("report"));
    expect(pane("report")).not.toBeNull();
    resolve(updatedAfterPush());
    await waitFor(() => expect(pane("result")).not.toBeNull());
    expect(cell("slot:0")).toHaveAttribute("aria-current", "true");
  });
});

