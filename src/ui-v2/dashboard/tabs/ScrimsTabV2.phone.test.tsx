import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import i18n from "@/i18n";
import { autofillPlans } from "@/lib/scrims/scrimPlans";
import { dismissOverlayWithBack } from "@/ui-v2/palette/paletteHistory";
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

const pane = (name: string) => document.querySelector(`[data-slot="scrim-${name}-pane"]`);
const home = () => document.querySelector('[data-slot="scrim-week-home"]');
const frame = () => document.querySelector('[data-slot="scrim-view-frame"]');
const frameHeading = () => frame()?.querySelector("[data-pane-heading]") as HTMLElement;
const heroEl = () => document.querySelector('[data-slot="phone-week-hero"]') as HTMLElement;
const entry = (name: string) => document.querySelector(`[data-slot="phone-week-entry"][data-home-control="${name}"]`) as HTMLElement;
const block = (slotIndex: number) => document.querySelector(`[data-slot="phone-week-block"][data-slot-index="${slotIndex}"]`) as HTMLElement;
const back = () => document.querySelector('[data-slot="scrim-view-back"]') as HTMLElement;
/** The title of the open view: its frame's heading, or null on Semana. */
const viewTitle = () => frame()?.querySelector('[data-slot="scrim-view-back"] span')?.textContent ?? null;

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
  it("fills its wrapper without a page scroll of its own, and the CSS rule lets the wrapper go", () => {
    const { container } = mount(monday());
    // The wrapper that DashboardV2 renders carries the attribute (see DashboardV2.phoneFixed.test); the root only fills it.
    expect(container.firstElementChild).not.toHaveAttribute("data-phone-fixed");
    expect(container.firstElementChild?.className).toContain("h-full");
    expect(container.firstElementChild?.className).toContain("min-h-0");
    expect(appCss).toMatch(/\[data-form="phone"\] #main-content > \[data-phone-fixed\]/);
    // Semana never scrolls: nothing in it is a scroll container.
    expect(home()?.className).not.toMatch(/overflow-(y-)?(auto|scroll)/);
    expect(container.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"]')).toBeNull();
  });

  it("a view has a top row of one target height with a real back button, the title as its heading and the body below", () => {
    mount(monday());
    fireEvent.click(entry("objective"));
    const top = document.querySelector('[data-slot="scrim-view-top"]') as HTMLElement;
    expect(top.className).toContain("h-[var(--hit)]");
    expect(back().tagName).toBe("BUTTON");
    expect(frameHeading().tagName).toBe("H2");
    expect(frameHeading()).toContainElement(back());
    expect(viewTitle()).toBe("Objective");
    expect(back()).toHaveAccessibleName("Back: Objective");
    const body = document.querySelector('[data-slot="scrim-view-body"]') as HTMLElement;
    expect(top.nextElementSibling).toBe(body);
    expect(body.className).not.toMatch(/overflow-(y-)?(auto|scroll)/);
    expect(home()).toBeNull();
  });

  it("keeps the early states: no team", () => {
    mount(monday(), game({ manager: { team_id: "nobody" } } as Partial<GameStateData>));
    expect(screen.getByText(/No team assigned/)).toBeInTheDocument();
    expect(home()).toBeNull();
  });
});

describe("ScrimsTabV2 on a phone: what opens on arrival", () => {
  it("opens Semana on a fresh Monday, its hero asking for the objective", () => {
    mount(monday());
    expect(home()).not.toBeNull();
    expect(frame()).toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "nextObjective");
  });

  it("opens Semana while planning, its hero pointing at the slot with no Plan A", () => {
    mount(planning());
    expect(home()).not.toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "nextSlot");
    expect(heroEl()).toHaveTextContent("Wed B");
  });

  it("opens Decidir by itself when a block waits for its decision", () => {
    mount(afterBlockA());
    expect(home()).toBeNull();
    expect(pane("decision")).not.toBeNull();
    expect(viewTitle()).toBe("Decide Wed A");
    expect(screen.getByRole("button", { name: /Push through/ })).toBeInTheDocument();
  });

  it("opens Semana on a scrim-day morning: the hero is today's block, with its sentence and the lock", () => {
    mount(scrimMorning());
    expect(home()).not.toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "today");
    expect(heroEl()).toHaveTextContent("Nothing to decide right now. Wed A plays against Alpha when you continue.");
    expect(heroEl()).toHaveTextContent("You confirmed this week's setup");
    expect(heroEl()).toHaveTextContent("Today's Risk");
    expect(within(heroEl()).queryAllByRole("button")).toHaveLength(0);
    expect(block(0)).toHaveAttribute("data-hero", "true");
  });

  it("opens a view from each control of Semana: the entries, the hero and a block", () => {
    mount(planning());
    fireEvent.click(entry("objective"));
    expect(pane("objective")).not.toBeNull();
    fireEvent.click(back());
    fireEvent.click(entry("volume"));
    expect(pane("volume")).not.toBeNull();
    fireEvent.click(back());
    fireEvent.click(entry("report"));
    expect(pane("report")).not.toBeNull();
    fireEvent.click(back());
    fireEvent.click(heroEl());
    expect(pane("slot")).not.toBeNull();
    expect(viewTitle()).toBe("Wed B");
    expect(screen.getByRole("group", { name: "Rivals by overall rating" })).toBeInTheDocument();
    fireEvent.click(back());
    fireEvent.click(block(2));
    expect(viewTitle()).toBe("Thu A");
  });

  it("a block of a locked week opens a read-only slot view, without the rivals", () => {
    mount(scrimMorning());
    fireEvent.click(block(2));
    expect(pane("slot")).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Rivals by overall rating" })).toBeNull();
  });
});

describe("ScrimsTabV2 on a phone: what moves by itself (BUILD-SPEC section 1)", () => {
  it("a row that starts to carry Decide opens by itself", () => {
    const { swap } = mount(scrimMorning());
    expect(home()).not.toBeNull();
    swap(afterBlockA());
    expect(pane("decision")).not.toBeNull();
    expect(viewTitle()).toBe("Decide Wed A");
  });

  it("a row that starts to carry Decide opens by itself even when the player was in another view", () => {
    const { swap } = mount(scrimMorning());
    fireEvent.click(entry("report"));
    swap(afterBlockA());
    expect(pane("decision")).not.toBeNull();
  });

  it("a row that starts to carry Today moves to Semana, whose hero shows it", () => {
    const { swap } = mount(planning());
    fireEvent.click(entry("report"));
    expect(pane("report")).not.toBeNull();
    swap(scrimMorning());
    expect(home()).not.toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "today");
  });

  it("a Next tag that moves because of the manager's own picks never moves anything", () => {
    const { swap } = mount(planning());
    fireEvent.click(entry("report"));
    swap(ctx(week({ objective: "Macro", planned: 2, slots: [slot(0, { plan: ["alpha"] }), slot(1, { plan: ["bravo"] }), slot(2), slot(3)] }), today()));
    expect(pane("report")).not.toBeNull();
    expect(home()).toBeNull();
  });

  it("opens Volume once after the objective is chosen", async () => {
    trainingMocks.setWeeklyScrimObjective.mockResolvedValue(game());
    mount(monday());
    fireEvent.click(entry("objective"));
    fireEvent.click(screen.getByRole("button", { name: /Fix early game/ }));
    expect(pane("volume")).not.toBeNull();
    expect(trainingMocks.setWeeklyScrimObjective).toHaveBeenCalledWith("EarlyGame");
    await waitFor(() => expect(trainingMocks.setWeeklyScrimObjective).toHaveBeenCalledTimes(1));
  });

  it("goes where phoneDoneTarget says on Done, and names that destination on its second line", () => {
    mount(planning());
    fireEvent.click(heroEl());
    const done = screen.getByRole("button", { name: /Done/ });
    // Wed B is open and has no Plan A: the next slot with no Plan A after it is Thu A.
    expect(done).toHaveTextContent("Thu A");
    fireEvent.click(done);
    expect(viewTitle()).toBe("Thu A");
    expect(screen.getByRole("button", { name: /Done/ })).toHaveTextContent("Thu B");
  });

  it("saves a rival pick at once through the shared plan code", async () => {
    trainingMocks.setWeeklyScrimPlans.mockResolvedValue(game());
    mount(planning());
    fireEvent.click(heroEl());
    const grid = screen.getByRole("group", { name: "Rivals by overall rating" });
    fireEvent.click(within(grid).getAllByRole("button")[0]);
    await waitFor(() => expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledTimes(1));
    const saved = trainingMocks.setWeeklyScrimPlans.mock.calls[0][0] as string[][];
    expect(saved[1][0]).not.toBe("");
    expect(saved[0][0]).toBe("alpha");
    expect(viewTitle()).toBe("Wed B");
  });

  it("the back control of a view returns to Semana", () => {
    mount(planning());
    fireEvent.click(entry("volume"));
    fireEvent.click(back());
    expect(home()).not.toBeNull();
    expect(frame()).toBeNull();
  });

  it("the system's Back returns to Semana from a view, and does nothing on Semana", () => {
    mount(planning());
    expect(dismissOverlayWithBack()).toBe(false);
    fireEvent.click(entry("report"));
    expect(frame()).not.toBeNull();
    act(() => {
      expect(dismissOverlayWithBack()).toBe(true);
    });
    expect(home()).not.toBeNull();
    expect(dismissOverlayWithBack()).toBe(false);
  });

  it("the system's Back also closes the decision view that opened by itself", () => {
    mount(afterBlockA());
    act(() => {
      expect(dismissOverlayWithBack()).toBe(true);
    });
    expect(home()).not.toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "decide");
    fireEvent.click(within(heroEl()).getByRole("button", { name: /Decide/ }));
    expect(pane("decision")).not.toBeNull();
  });
});

describe("ScrimsTabV2 on a phone: the cancel step", () => {
  it("opens the follow-up without calling the backend and Back returns to the decision", async () => {
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Cancel scrims/ }));
    expect(trainingMocks.chooseDailyScrimAction).not.toHaveBeenCalled();
    expect(pane("followup")).not.toBeNull();
    expect(viewTitle()).toBe("Cancel scrims");
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
    fireEvent.click(screen.getByRole("button", { name: /Back to block decision/ }));
    expect(pane("decision")).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
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

  it("replaces the cards with the result, titled as the block's review, and moves focus to the frame's heading", async () => {
    await decide();
    expect(trainingMocks.chooseDailyScrimAction).toHaveBeenCalledWith(0, "PushThrough");
    expect(pane("decision")).toBeNull();
    expect(viewTitle()).toBe("Block review");
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
    expect(pane("result")?.querySelector("[aria-live]")).toBeNull();
    expect(pane("result")).toHaveTextContent("Decision applied to scrim block: Push through");
  });

  it("stays on the result when the tag moves to the block that waits, and Decide <slot> opens that block", async () => {
    const { swap } = await decide();
    swap(afterPushThrough());
    expect(pane("result")).not.toBeNull();
    expect(home()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Decide Wed B" }));
    expect(pane("decision")).not.toBeNull();
    expect(viewTitle()).toBe("Decide Wed B");
  });

  it("leaves the result with the back control, and Semana then shows the block that waits", async () => {
    const { swap } = await decide();
    swap(afterPushThrough());
    fireEvent.click(back());
    expect(home()).not.toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "decide");
    expect(heroEl()).toHaveTextContent("Wed B");
    expect(block(0)).toHaveTextContent("Q73");
  });
});

describe("ScrimsTabV2 on a phone: the same actions as desktop", () => {
  it("Autofill saves the dealt plans through the backend call desktop uses", async () => {
    trainingMocks.setWeeklyScrimPlans.mockResolvedValue(game());
    mount(planning());
    fireEvent.click(entry("volume"));
    fireEvent.click(screen.getByRole("button", { name: /Autofill/ }));
    await waitFor(() => expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledTimes(1));
    // Same deal as the desktop button: every rival, strongest first (equal here, so by name), into all four slots.
    expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledWith(autofillPlans(RIVALS, "Macro", 4));
  });

  it("Finalize setup calls the backend once", async () => {
    trainingMocks.finalizeWeeklyScrimSetup.mockResolvedValue(game());
    mount(planning());
    fireEvent.click(entry("volume"));
    fireEvent.click(screen.getByRole("button", { name: /Finalize setup/i }));
    await waitFor(() => expect(trainingMocks.finalizeWeeklyScrimSetup).toHaveBeenCalledTimes(1));
  });

  it("with the assistant on the views are read-only and the volume view says who handles scrims", () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, scrim_review_mode: "assistant" } });
    mount(planning());
    expect(heroEl()).toHaveTextContent("Locked");
    fireEvent.click(entry("objective"));
    const choices = within(screen.getByRole("group", { name: "Weekly objective" })).getAllByRole("button");
    expect(choices.every((choice) => choice.getAttribute("aria-disabled") === "true")).toBe(true);
    fireEvent.click(choices[1]);
    expect(trainingMocks.setWeeklyScrimObjective).not.toHaveBeenCalled();
    fireEvent.click(back());
    fireEvent.click(block(0));
    expect(pane("slot")).not.toBeNull();
    expect(screen.queryByRole("group", { name: "Rivals by overall rating" })).toBeNull();
    fireEvent.click(back());
    fireEvent.click(entry("volume"));
    expect(screen.getByText("Assistant is handling scrims")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Finalize setup/i })).toBeNull();
  });

  it("a locked week shows its sentence on the first line of the locked views, and only the word Locked on Semana", () => {
    mount(ctx(week({ setupLocked: true, setupLockedReason: "manual", objective: "Macro", planned: 4, slots: [0, 1, 2, 3].map((i) => slot(i, { plan: ["alpha"], status: "Locked", canEdit: false })) }), today()));
    expect(screen.queryByText(/You confirmed this week's setup/)).toBeNull();
    expect(heroEl()).toHaveTextContent("Locked");
    fireEvent.click(entry("objective"));
    expect(screen.getByText(/You confirmed this week's setup/)).toBeInTheDocument();
    fireEvent.click(back());
    fireEvent.click(block(0));
    expect(screen.getByText(/You confirmed this week's setup/)).toBeInTheDocument();
  });

  it("career start: Semana is shown read-only and its hero carries the sentence", () => {
    mount(ctx(week({ setupLocked: true, setupLockedReason: "career_started_late", slots: [0, 1, 2, 3].map((i) => slot(i, { status: "Locked", canEdit: false })) }), today()));
    expect(home()).not.toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "careerStartLate");
    expect(heroEl()).toHaveTextContent(/Your career starts after this week's scrim days/);
  });
});

describe("ScrimsTabV2 on a phone: the shared decision text map", () => {
  it("lives in lib/scrims and covers every decision", async () => {
    const { DECISION_TEXT_KEY } = await import("@/lib/scrims/decisionTextKey");
    expect(DECISION_TEXT_KEY.PushThrough).toBe("pushThrough");
    expect(Object.keys(DECISION_TEXT_KEY)).toHaveLength(8);
  });
});

describe("ScrimsTabV2 on a phone: focus", () => {
  it("moves focus to the view's heading when a control of Semana opens it", async () => {
    mount(planning());
    fireEvent.click(entry("volume"));
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
  });

  it("returns focus to the control that opened the view when the back control closes it", async () => {
    mount(planning());
    for (const [open, control] of [[() => fireEvent.click(entry("volume")), () => entry("volume")], [() => fireEvent.click(heroEl()), () => heroEl()], [() => fireEvent.click(block(2)), () => block(2)]] as const) {
      open();
      await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
      fireEvent.click(back());
      await waitFor(() => expect(document.activeElement).toBe(control()));
    }
  });

  it("returns focus to the opener after the system's Back too", async () => {
    mount(planning());
    fireEvent.click(entry("report"));
    act(() => {
      dismissOverlayWithBack();
    });
    await waitFor(() => expect(document.activeElement).toBe(entry("report")));
  });

  it("returns focus to the first entry when the opener is gone (a view the game opened by itself)", async () => {
    mount(afterBlockA());
    fireEvent.click(back());
    await waitFor(() => expect(document.activeElement).toBe(entry("objective")));
  });

  it("moves focus to the new view's heading after Done", async () => {
    mount(planning());
    fireEvent.click(heroEl());
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    expect(viewTitle()).toBe("Thu A");
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
  });

  it("moves focus to the decision view's heading after Decide <slot>", async () => {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedAfterPush());
    const { swap } = mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    await waitFor(() => expect(pane("result")).not.toBeNull());
    swap(afterPushThrough());
    fireEvent.click(screen.getByRole("button", { name: "Decide Wed B" }));
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
  });

  it("does not take focus from a control outside the screen when the game moves the view by itself", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const { swap } = mount(scrimMorning());
    outside.focus();
    swap(afterBlockA());
    expect(pane("decision")).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe("ScrimsTabV2 on a phone: the live line", () => {
  const liveRegions = () => [...document.querySelectorAll('[aria-live], [role="status"]')] as HTMLElement[];
  const holding = (text: string) => liveRegions().filter((el) => el.textContent?.includes(text));

  it("has one polite region mounted on Semana and in the views, and the result view's own line is not live", async () => {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedAfterPush());
    mount(planning());
    expect(liveRegions()).toHaveLength(1);
    fireEvent.click(entry("report"));
    expect(liveRegions()).toHaveLength(1);
    fireEvent.click(back());
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0]).toHaveAttribute("aria-live", "polite");
  });

  it("the same node holds a decision's text once, and the result view's own line is not live", async () => {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedAfterPush());
    mount(afterBlockA());
    const before = liveRegions();
    expect(before).toHaveLength(1);
    expect(before[0].textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    await waitFor(() => expect(pane("result")).not.toBeNull());
    expect(liveRegions()[0]).toBe(before[0]);
    expect(holding("Push through")).toHaveLength(1);
    expect(pane("result")?.querySelector("[aria-live]")).toBeNull();
  });

  it("shows the result of the block the decision was taken on even if the player left for another view during the save", async () => {
    let resolve!: (state: GameStateData) => void;
    trainingMocks.chooseDailyScrimAction.mockReturnValue(new Promise<GameStateData>((done) => (resolve = done)));
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    fireEvent.click(back());
    fireEvent.click(entry("report"));
    expect(pane("report")).not.toBeNull();
    resolve(updatedAfterPush());
    await waitFor(() => expect(pane("result")).not.toBeNull());
    expect(viewTitle()).toBe("Block review");
  });
});
