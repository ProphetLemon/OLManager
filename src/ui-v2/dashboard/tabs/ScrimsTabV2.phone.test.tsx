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

const pane = (name: string) => document.querySelector(`[data-slot="${name === "slot" ? "scrim-pick-view" : `scrim-${name}-pane`}"]`);
const strip = () => screen.getByRole("group", { name: "Rivals by overall rating" });
const planTab = (letter: string) => within(screen.getByRole("group", { name: "Opponent plans" })).getByRole("button", { name: new RegExp(`^Plan ${letter}`) });
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
  const swap = (next: ScrimContextResponse, nextState = state) => {
    contextMock.current = next;
    utils.rerender(<ScrimsTabV2 gameState={nextState} onGameUpdate={onGameUpdate} />);
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
    // Semana scrolls inside itself only as a safety when its area is shorter than its content; nothing in it does.
    expect(home()?.className).toContain("overflow-y-auto");
    expect(home()?.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"]')).toBeNull();
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
    expect(body.className).toContain("overflow-y-auto");
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

  it("the decision that opens by itself has one heading and none of the old tag words", () => {
    mount(afterBlockA());
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(frameHeading()).toHaveTextContent("Decide Wed A");
    expect(pane("decision")?.textContent).not.toMatch(/\+Volume|\+Learning|\+Fatigue|\+Impulse/);
    expect(pane("decision")?.querySelectorAll('[data-slot="decision-card"]')).toHaveLength(2);
    expect(frame()?.querySelector('[data-slot="decision-lock"]')).toHaveTextContent("Locked");
  });

  it("opens Semana on a scrim-day morning: the hero is today's block, with its sentence and the lock", () => {
    mount(scrimMorning());
    expect(home()).not.toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "today");
    expect(heroEl()).toHaveTextContent("Nothing to decide right now. Wed A plays against Alpha when you continue.");
    expect(heroEl()).toHaveTextContent("Locked");
    expect(heroEl()).not.toHaveTextContent("You confirmed this week's setup");
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
    expect(within(strip()).getAllByRole("button")).toHaveLength(4);
    fireEvent.click(back());
    fireEvent.click(block(2));
    expect(viewTitle()).toBe("Thu A");
  });

  it("a block of a locked week opens a read-only slot view: the plans can be looked at, no rival can be tapped", () => {
    mount(scrimMorning());
    fireEvent.click(block(2));
    expect(pane("slot")).not.toBeNull();
    expect(within(strip()).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Not planned" })).toBeNull();
    expect(planTab("A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Done/ })).toBeInTheDocument();
  });

  it("a played block opens read-only with the plan that was played marked and an empty plan worded as the game words it", () => {
    const played = report({ opponent_team_id: "bravo" });
    mount(
      ctx(
        week({
          setupLocked: true,
          setupLockedReason: "week_started",
          objective: "Macro",
          planned: 4,
          played: 1,
          slots: [
            slot(0, { plan: ["alpha", "bravo"], status: "Reviewed", canEdit: false, resolvedOpponentTeamId: "bravo", resultWon: true, report: played }),
            slot(1, { plan: ["bravo"], status: "Locked", canEdit: false }),
            slot(2, { plan: ["charlie"], status: "Locked", canEdit: false }),
            slot(3, { plan: ["delta"], status: "Locked", canEdit: false }),
          ],
        }),
        today(),
      ),
    );
    fireEvent.click(block(0));
    expect(planTab("B")).toHaveAccessibleName(/Played/);
    expect(planTab("B")).toHaveAttribute("aria-pressed", "true");
    expect(planTab("A")).not.toHaveAccessibleName(/Played/);
    // The strip stays (BUILD-SPEC section 4) with the sentence beside it, outside the scroller.
    expect(document.querySelector('[data-slot="pick-lock-note"]')!.nextElementSibling).toBe(strip());
    expect(planTab("C")).toHaveAccessibleName(/No fallback/);
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

  it("Semana's hero puts the lock on the word's line and lets the closed-day sentence take its lines whole", () => {
    mount(
      ctx(
        week({
          setupLocked: true,
          setupLockedReason: "week_started",
          objective: "Macro",
          planned: 4,
          played: 1,
          slots: [
            slot(0, { plan: ["alpha"], status: "Reviewed", canEdit: false, resolvedOpponentTeamId: "alpha", resultWon: true, report: report({ won: true }) }),
            slot(1, { plan: ["bravo"], status: "Locked", canEdit: false }),
            slot(2, { plan: ["charlie"], status: "Locked", canEdit: false }),
            slot(3, { plan: ["delta"], status: "Locked", canEdit: false }),
          ],
        }),
        today({ state: "Reviewed", slotIndex: 0 }),
      ),
    );
    const hero = document.querySelector('[data-slot="phone-week-hero"]') as HTMLElement;
    const word = hero.querySelector('[data-slot="phone-week-word"]') as HTMLElement;
    const lock = hero.querySelector('[data-slot="phone-week-lock"]') as HTMLElement;
    const row = lock.closest('[data-slot="phone-week-word-row"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row).toContainElement(word);
    const closed = hero.querySelector('[data-slot="phone-week-closed"]') as HTMLElement;
    expect(closed.className).not.toContain("truncate");
    expect(closed.className).not.toContain("line-clamp");
    // Shield 32 + name 16 + gap 2 = 50 and a two-line sentence 28 = 78: the 90 px hero holds it all.
    expect(hero.querySelector('[data-slot="phone-week-matchup"] [data-slot="club-shield"]')!.className).toContain("size-8");
  });

  it("Decidir never cuts the team names under the medium shields: they take two lines", () => {
    const { swap } = mount(scrimMorning());
    swap(afterBlockA());
    const names = [...document.querySelectorAll('[data-slot="phone-matchup-team"] > span')];
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name.className).toContain("line-clamp-2");
      expect(name.className).not.toContain("truncate");
    }
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
    fireEvent.click(within(strip()).getAllByRole("button")[0]);
    await waitFor(() => expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledTimes(1));
    const saved = trainingMocks.setWeeklyScrimPlans.mock.calls[0][0] as string[][];
    expect(saved[1][0]).not.toBe("");
    expect(saved[0][0]).toBe("alpha");
    expect(viewTitle()).toBe("Wed B");
    // A pick saves once and the plan being filled stays Plan A: it does not move on by itself.
    expect(planTab("A")).toHaveAttribute("aria-pressed", "true");
    expect(planTab("B")).toHaveAttribute("aria-pressed", "false");
    expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledTimes(1);
  });

  it("fills Plan B of the slot only when the manager taps its tab, then saves into that plan", async () => {
    trainingMocks.setWeeklyScrimPlans.mockResolvedValue(game());
    mount(planning());
    fireEvent.click(heroEl());
    fireEvent.click(planTab("B"));
    fireEvent.click(within(strip()).getAllByRole("button")[1]);
    await waitFor(() => expect(trainingMocks.setWeeklyScrimPlans).toHaveBeenCalledTimes(1));
    const saved = trainingMocks.setWeeklyScrimPlans.mock.calls[0][0] as string[][];
    expect(saved[1][1]).not.toBe("");
    expect(saved[1][0] ?? "").toBe("");
    expect(planTab("B")).toHaveAttribute("aria-pressed", "true");
  });

  it("the back control and the system's Back leave Elegir rival for Semana, and Back closes its help first", () => {
    mount(planning());
    fireEvent.click(heroEl());
    expect(pane("slot")).not.toBeNull();
    fireEvent.click(back());
    expect(home()).not.toBeNull();
    fireEvent.click(block(2));
    fireEvent.click(screen.getByRole("button", { name: /Win \/ Accepts/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      expect(dismissOverlayWithBack()).toBe(true);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pane("slot")).not.toBeNull();
    act(() => {
      expect(dismissOverlayWithBack()).toBe(true);
    });
    expect(home()).not.toBeNull();
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
    fireEvent.click(back());
    expect(pane("decision")).not.toBeNull();
    expect(home()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
  });

  it("shows the three follow-ups as rows and says what any of them cancels in the top row", () => {
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Cancel scrims/ }));
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    const rows = [...document.querySelectorAll('[data-slot="decision-card"]')].map((row) => row.querySelector("button")?.textContent);
    expect(rows).toEqual(["VOD Review", "Mental Reset", "Targeted Drills"]);
    expect(frame()?.querySelector('[data-slot="scrim-view-top"]')).toHaveTextContent("Cancels block B. Scrim rep -5, cancellations +1.");
    expect(screen.queryByRole("button", { name: /Back to block decision/ })).toBeNull();
  });

  it("the system's Back in the follow-ups returns to the decision, not to Semana, and then leaves for Semana", () => {
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Cancel scrims/ }));
    expect(pane("followup")).not.toBeNull();
    act(() => {
      expect(dismissOverlayWithBack()).toBe(true);
    });
    expect(pane("followup")).toBeNull();
    expect(pane("decision")).not.toBeNull();
    expect(home()).toBeNull();
    act(() => {
      expect(dismissOverlayWithBack()).toBe(true);
    });
    expect(home()).not.toBeNull();
  });

  it("choosing a follow-up shows the result, and the one live line says the decision", async () => {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedAfterPush());
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Cancel scrims/ }));
    fireEvent.click(screen.getByRole("button", { name: "VOD Review" }));
    await waitFor(() => expect(pane("result")).not.toBeNull());
    expect(trainingMocks.chooseDailyScrimAction).toHaveBeenCalledWith(0, "VodReview");
    expect(viewTitle()).toBe("Block review");
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent("Decision applied to scrim block: VOD Review");
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
    expect(frame()?.querySelector('[data-slot="result-applied"]')).toHaveTextContent("Decision applied to scrim block: Push through");
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

describe("ScrimsTabV2 on a phone: the day's other block in the result view", () => {
  const otherBlock = () => document.querySelector('[data-slot="result-block-b"]') as HTMLElement;

  /** Mon..: A won and decided (Continue to block 2), B lost and waiting for its decision. */
  const bPending = () => {
    const a = report({ won: true, post_decision: "PushThrough" });
    const b = report({ slot_index: 1, opponent_team_id: "bravo" });
    const c = afterBlockA();
    c.week.slots[0] = { ...c.week.slots[0], status: "Reviewed", resultWon: true, report: a };
    c.week.slots[1] = { ...c.week.slots[1], status: "Played", resultWon: false, report: b, resolvedOpponentTeamId: "bravo" };
    return ctx(c.week, today({ state: "PlayedNeedsReview", slotIndex: 1, opponentTeamId: "bravo", report: b, canReview: true }));
  };
  const bDecided = () => {
    const c = bPending();
    const b = report({ slot_index: 1, opponent_team_id: "bravo", post_decision: "VodReview" });
    c.week.slots[1] = { ...c.week.slots[1], status: "Reviewed", report: b };
    return ctx(c.week, today({ state: "Reviewed", slotIndex: 1 }));
  };
  const updatedBoth = (): GameStateData => {
    const base = game();
    const mine = base.teams.find((t) => t.id === "mine") as TeamData;
    mine.scrim_reports = [report({ won: true, post_decision: "PushThrough" }), report({ slot_index: 1, opponent_team_id: "bravo", post_decision: "VodReview" })];
    return base;
  };

  it("the review of the first block says the second is played and its report waits while its decision is pending", async () => {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedAfterPush());
    const { swap } = mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    await waitFor(() => expect(pane("result")).not.toBeNull());
    swap(afterPushThrough());
    expect(otherBlock()).toHaveTextContent("Played, report waiting");
    expect(otherBlock().querySelector('[data-slot="phone-result-word"]')).toBeNull();
  });

  it("the review of the second block shows the first one's result word once its own decision was taken", async () => {
    trainingMocks.chooseDailyScrimAction.mockResolvedValue(updatedBoth());
    const { swap } = mount(bPending());
    fireEvent.click(screen.getByRole("button", { name: "VOD Review" }));
    await waitFor(() => expect(pane("result")).not.toBeNull());
    swap(bDecided());
    expect(viewTitle()).toBe("Block review");
    expect(otherBlock()).toHaveTextContent("Wed A");
    expect(otherBlock()).not.toHaveTextContent("report waiting");
    expect(otherBlock().querySelector('[data-slot="phone-result-word"]')).toHaveAttribute("data-result", "won");
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
    expect(within(strip()).queryAllByRole("button")).toHaveLength(0);
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

  it("a view the game opens later does not return focus to a control that opened an earlier one", async () => {
    const { swap } = mount(scrimMorning());
    fireEvent.click(entry("volume"));
    fireEvent.click(back());
    await waitFor(() => expect(document.activeElement).toBe(entry("volume")));
    swap(afterBlockA());
    expect(pane("decision")).not.toBeNull();
    fireEvent.click(back());
    await waitFor(() => expect(document.activeElement).toBe(entry("objective")));
  });

  it("a move from view to view (Done) forgets the control that opened the first", async () => {
    mount(planning());
    fireEvent.click(heroEl());
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
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

describe("ScrimsTabV2 on a phone: moves the game makes while the player is elsewhere", () => {
  const unplannedToday = () =>
    ctx(
      week({ objective: "Macro", planned: 1, slots: [slot(0), slot(1, { plan: ["bravo"] }), slot(2, { plan: ["charlie"] }), slot(3, { plan: ["delta"] })] }),
      today({ state: "Planned", slotIndex: 0, opponentTeamId: null, canEditPlan: true }),
    );
  const plannedTodayCtx = () =>
    ctx(
      week({ objective: "Macro", planned: 4, slots: [slot(0, { plan: ["alpha"] }), slot(1, { plan: ["bravo"] }), slot(2, { plan: ["charlie"] }), slot(3, { plan: ["delta"] })] }),
      today({ state: "Planned", slotIndex: 0, opponentTeamId: "alpha", resolvedOpponentTeamId: "alpha", canEditPlan: true }),
    );

  it("the manager's own pick that makes the open block carry Today moves nothing", () => {
    const { swap } = mount(unplannedToday());
    fireEvent.click(block(0));
    expect(viewTitle()).toBe("Wed A");
    swap(plannedTodayCtx());
    expect(frame()).not.toBeNull();
    expect(viewTitle()).toBe("Wed A");
  });

  it("a day that advances so the open block carries Today moves to Semana", () => {
    const { swap } = mount(unplannedToday());
    fireEvent.click(block(0));
    const tomorrow = game({ clock: { current_date: "2026-04-30", start_date: "2026-01-01T12:00:00Z" } } as Partial<GameStateData>);
    swap(plannedTodayCtx(), tomorrow);
    expect(home()).not.toBeNull();
    expect(heroEl()).toHaveAttribute("data-state", "today");
  });

  it("a result and a Decide tag arriving in the same render, with the manager on Semana: the result's block opens, focused", async () => {
    let resolve!: (state: GameStateData) => void;
    trainingMocks.chooseDailyScrimAction.mockReturnValue(new Promise<GameStateData>((done) => (resolve = done)));
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    fireEvent.click(back());
    expect(home()).not.toBeNull();
    contextMock.current = afterPushThrough();
    resolve(updatedAfterPush());
    await waitFor(() => expect(pane("result")).not.toBeNull());
    expect(viewTitle()).toBe("Block review");
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
    expect(screen.getByRole("button", { name: "Decide Wed B" })).toBeInTheDocument();
  });

  it("the same with the manager on another view", async () => {
    let resolve!: (state: GameStateData) => void;
    trainingMocks.chooseDailyScrimAction.mockReturnValue(new Promise<GameStateData>((done) => (resolve = done)));
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    fireEvent.click(back());
    fireEvent.click(entry("report"));
    contextMock.current = afterPushThrough();
    resolve(updatedAfterPush());
    await waitFor(() => expect(pane("result")).not.toBeNull());
    expect(viewTitle()).toBe("Block review");
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
  });

  it("a result that arrives while another view is open takes focus to its heading", async () => {
    let resolve!: (state: GameStateData) => void;
    trainingMocks.chooseDailyScrimAction.mockReturnValue(new Promise<GameStateData>((done) => (resolve = done)));
    mount(afterBlockA());
    fireEvent.click(screen.getByRole("button", { name: /Push through/ }));
    fireEvent.click(back());
    fireEvent.click(entry("report"));
    resolve(updatedAfterPush());
    await waitFor(() => expect(pane("result")).not.toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(frameHeading()));
  });

  it("re-mounting the tab opens by the arrival rule again", () => {
    const first = mount(afterBlockA());
    fireEvent.click(back());
    expect(home()).not.toBeNull();
    first.unmount();
    const second = mount(afterBlockA());
    expect(pane("decision")).not.toBeNull();
    second.unmount();
    mount(planning());
    expect(home()).not.toBeNull();
  });

  it("a game-made move to Semana leaves focus alone when it sits outside the screen", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const { swap } = mount(planning());
    fireEvent.click(entry("report"));
    outside.focus();
    swap(scrimMorning());
    expect(home()).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe("ScrimsTabV2 on a phone: the three settings views", () => {
  it("each entry of Semana opens its view with one heading, the frame's title", () => {
    mount(planning());
    for (const [name, title] of [["objective", "Objective"], ["volume", "Volume"], ["report", "Report"]] as const) {
      fireEvent.click(entry(name));
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
      expect(frameHeading()).toHaveTextContent(title);
      expect(viewTitle()).toBe(title);
      fireEvent.click(back());
      expect(home()).not.toBeNull();
    }
  });

  it("Objetivo and Volumen have no second heading and no card behind the whole view", () => {
    mount(planning());
    for (const name of ["objective", "volume"]) {
      fireEvent.click(entry(name));
      expect(screen.getAllByRole("heading")).toHaveLength(1);
      expect((document.querySelector('[data-slot="scrim-view-body"]') as HTMLElement).className).not.toContain("bg-card");
      fireEvent.click(back());
    }
  });

  it("an objective chosen from Semana moves to Volumen once; opening Objetivo again stays there", async () => {
    trainingMocks.setWeeklyScrimObjective.mockResolvedValue(game());
    mount(monday());
    fireEvent.click(entry("objective"));
    fireEvent.click(screen.getByRole("button", { name: /Fix early game/ }));
    expect(viewTitle()).toBe("Volume");
    fireEvent.click(back());
    fireEvent.click(entry("objective"));
    expect(viewTitle()).toBe("Objective");
    await waitFor(() => expect(trainingMocks.setWeeklyScrimObjective).toHaveBeenCalledTimes(1));
  });

  it("Volumen puts Confirmar in the last row, outlined, away from Rellenar and out of the top row", () => {
    mount(planning());
    fireEvent.click(entry("volume"));
    const confirm = screen.getByRole("button", { name: /Finalize setup/i });
    const fill = screen.getByRole("button", { name: /Autofill/ });
    expect(document.querySelector('[data-slot="scrim-view-top"]')).not.toContainElement(confirm);
    expect(confirm.parentElement).not.toBe(fill.parentElement);
    expect(confirm.className).not.toMatch(/\bbg-(club|primary)/);
  });

  it("a volume tap saves through the same handler as before", async () => {
    trainingMocks.setWeeklyScrimSlots.mockResolvedValue(game());
    mount(planning());
    fireEvent.click(entry("volume"));
    fireEvent.click(screen.getByRole("button", { name: /^Volume 6/ }));
    await waitFor(() => expect(trainingMocks.setWeeklyScrimSlots).toHaveBeenCalledTimes(1));
  });

  it("Informe shows the week's Rep scrims and Cancelaciones, and the latest block as a matchup", () => {
    const played = report({ quality: 68 });
    mount(ctx(week({ reputation: 25, cancellations: 1, played: 1, losses: 1, lossStreak: 1, latestReports: [played], slots: [slot(0, { status: "Played", canEdit: false, resultWon: false, report: played }), slot(1), slot(2), slot(3)] }), today()));
    fireEvent.click(entry("report"));
    expect(screen.getByRole("meter", { name: "Scrim rep" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Cancellations").nextSibling).toHaveTextContent("1");
    const card = document.querySelector('[data-slot="report-block"]') as HTMLElement;
    expect(card).toHaveTextContent("Alpha");
    expect(card).toHaveTextContent("Loss");
    expect(card).toHaveTextContent("Wed A");
    expect(card).toHaveTextContent("68");
  });

  it("Elegir rival draws the focus ring of a strip button inside it, so the strip's clipping cannot cut it", () => {
    mount(planning());
    fireEvent.click(block(1));
    const buttons = within(strip()).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button.className).toContain("focus-visible:ring-inset");
  });

  it("Volumen of a locked week says Locked in the top row and the whole lock sentence at the bottom", () => {
    mount(scrimMorning());
    fireEvent.click(entry("volume"));
    expect(document.querySelector('[data-slot="scrim-view-top"]')).toHaveTextContent("Locked");
    const sentence = document.querySelector('[data-slot="volume-lock-sentence"]') as HTMLElement;
    expect(sentence.textContent?.length).toBeGreaterThan(10);
    expect(document.querySelector('[data-slot="scrim-view-top"]')).not.toContainElement(sentence);
  });

  it("Volumen keeps Confirmar clear of the assistant switch: Rellenar is narrower and the gap shorter, so the switch ends before Confirmar starts", () => {
    mount(planning());
    fireEvent.click(entry("volume"));
    const [first, last] = [...document.querySelectorAll('[data-slot="volume-row"]')] as HTMLElement[];
    // At 696: Rellenar 160 + gap 32 + the switch about 196 end at 388, and Confirmar (268 or more, at the right end) starts at 412 at the latest.
    expect(first.className).toContain("gap-8");
    expect(within(first).getByRole("button", { name: /Autofill/ }).className).toContain("min-w-[10rem]");
    expect(within(last).getByRole("button", { name: /Finalize Setup/ })).toBe(last.lastElementChild);
  });

  it("Informe with a report keeps the record, the newest block, Rep scrims with its bar and Cancelaciones above anything that scrolls", () => {
    const played = report({ quality: 68 });
    mount(ctx(week({ reputation: 25, cancellations: 1, played: 1, losses: 1, lossStreak: 1, latestReports: [played], slots: [slot(0, { status: "Played", canEdit: false, resultWon: false, report: played }), slot(1), slot(2), slot(3)] }), today()));
    fireEvent.click(entry("report"));
    const pane = document.querySelector('[data-slot="scrim-report-pane"]') as HTMLElement;
    const card = pane.querySelector('[data-slot="report-block"]') as HTMLElement;
    // Calidad, its number and its bar share one line; the focus and the issue sit side by side, label over value.
    const quality = within(card).getByRole("meter", { name: "Quality" });
    expect(quality.parentElement).toContainElement(within(card).getByText("Quality"));
    expect(card.querySelector("dl")!.className).toContain("grid-cols-2");
    expect(within(card).getByText("Report focus").nextElementSibling).toHaveTextContent("Fix early game");
    // Height at 286: 226 for the pane; the card about 132 (py-2, 52 shield column or a 100 text column), a gap of 8 and a row of 46 = 186, so Rep scrims and Cancelaciones need no scrolling.
    const row = within(pane).getByText("Cancellations").parentElement!.parentElement as HTMLElement;
    expect(row.className).not.toMatch(/\bmt-/);
    expect(card.className).toContain("py-2");
    const kids = [...pane.children];
    expect(kids.indexOf(row)).toBeLessThan(kids.findIndex((child) => child.getAttribute("data-slot") === "scrim-staff-suggestions"));
  });

  it("Informe with no reports says so and still shows Rep scrims and Cancelaciones", () => {
    mount(ctx(week({ reputation: 40, cancellations: 2 }), today()));
    fireEvent.click(entry("report"));
    expect(screen.getByText("No recent reports")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Scrim rep" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("Cancellations").nextSibling).toHaveTextContent("2");
  });
});
