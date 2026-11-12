import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScrimContextResponse } from "@/lib/scrims/scrimContext";
import type { GameStateData, ScrimReportData, TeamData } from "@/store/gameStore";
import { ScrimsTabV2 } from "@/ui-v2/dashboard/tabs/ScrimsTabV2";

const chooseDailyScrimActionMock = vi.fn();
const useScrimContextWithFallbackMock = vi.fn();

// A key with parameters reads back as `key a=1 b=2`, so the tests can see the numbers a text was built from.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === "string") return options;
      if (!options) return key;
      if (typeof options.defaultValue === "string") return options.defaultValue;
      const params = Object.entries(options).map(([name, value]) => `${name}=${value}`);
      return params.length > 0 ? `${key} ${params.join(" ")}` : key;
    },
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/services/trainingService", () => ({
  chooseDailyScrimAction: (...args: unknown[]) => chooseDailyScrimActionMock(...args),
  finalizeWeeklyScrimSetup: vi.fn(),
  getScrimContext: vi.fn(),
  setWeeklyScrimObjective: vi.fn(),
  setWeeklyScrimPlans: vi.fn(),
  setWeeklyScrimSlots: vi.fn(),
}));

vi.mock("@/hooks/useScrimContextWithFallback", () => ({
  useScrimContextWithFallback: (...args: unknown[]) => useScrimContextWithFallbackMock(...args),
}));

function report(overrides: Partial<ScrimReportData> = {}): ScrimReportData {
  return {
    date: "2026-03-11",
    week_key: "2026-W11",
    slot_index: 0,
    weekday: 2,
    team_id: "mine",
    opponent_team_id: "northglass",
    status: "Played",
    won: false,
    focus: "Macro",
    issue: "ObjectiveSetup",
    severity: 2,
    quality: 65,
    player_champion_picks: [],
    post_decision: null,
    created_on: "2026-03-11",
    ...overrides,
  };
}

function team(id: string, name: string, extra: Partial<TeamData> = {}): TeamData {
  return { id, name, short_name: name.slice(0, 3), starting_xi_ids: [], form: [], history: [], ...extra } as unknown as TeamData;
}

function game(mine: Partial<TeamData> = {}): GameStateData {
  return {
    manager: { team_id: "mine" },
    teams: [
      team("mine", "Kestrel Vale", { scrim_weekly_slots: 4, scrim_reputation: 38, scrim_weekly_cancellations: 0, ...mine }),
      team("northglass", "Northglass", { scrim_reputation: 44 }),
    ],
    players: [],
    clock: { current_date: "2026-03-11" },
    day_phase: "ScrimBlock",
  } as unknown as GameStateData;
}

function slotOf(index: number, extra: Record<string, unknown> = {}) {
  return {
    slotIndex: index,
    weekday: index < 2 ? 2 : 3,
    label: "",
    labelDay: index < 2 ? 2 : 3,
    labelSuffix: index % 2 === 0 ? "A" : "B",
    plan: [],
    resolvedOpponentTeamId: null,
    resultWon: null,
    report: null,
    status: "Open",
    canEdit: false,
    ...extra,
  };
}

function decisionContext(current: ScrimReportData, lossStreak = 1): ScrimContextResponse {
  return {
    today: {
      state: "PlayedNeedsReview",
      slotIndex: current.slot_index,
      opponentTeamId: "northglass",
      resolvedOpponentTeamId: "northglass",
      objective: "Macro",
      report: current,
      canEditPlan: false,
      canCancel: false,
      canReview: true,
      canViewWeeklyPlan: true,
      hasOfficialMatch: false,
      primaryAction: "Review",
      pushThroughRecommended: false,
    },
    week: {
      weekKey: "2026-W11",
      objective: "Macro",
      capacity: 4,
      planned: 2,
      reputation: 38,
      cancellations: 0,
      played: 1,
      wins: 0,
      losses: 1,
      lossStreak,
      avgQuality: current.quality,
      topFocus: "Macro",
      topIssue: "ObjectiveSetup",
      nextOfficialRivalTeamId: null,
      nextOfficialRivalCompetition: null,
      setupLocked: true,
      setupLockedReason: "week_started",
      canFinalizeSetup: true,
      slots: [
        slotOf(0, { status: "Played", report: current, resultWon: current.won, resolvedOpponentTeamId: "northglass", plan: ["northglass"] }),
        slotOf(1, { plan: ["northglass"] }),
        slotOf(2),
        slotOf(3),
      ],
      latestReports: [current],
    },
  } as unknown as ScrimContextResponse;
}

function show(current: ScrimReportData, lossStreak = 1, onGameUpdate = vi.fn()) {
  useScrimContextWithFallbackMock.mockReturnValue(decisionContext(current, lossStreak));
  render(<ScrimsTabV2 gameState={game()} onGameUpdate={onGameUpdate} />);
  return onGameUpdate;
}

/** The text of the elements a decision button points to with aria-describedby. */
function describedBy(name: string): string {
  const button = screen.getByRole("button", { name });
  const ids = (button.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  expect(ids.length).toBeGreaterThan(0);
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" | ");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decision cards show what a choice does", () => {
  it("links each card's effects, tags and description to its button", () => {
    show(report());
    const text = describedBy("scrims.decision.pushThrough");
    expect(text).toContain("scrims.decision.pushThroughDesc");
    expect(text).toContain("scrims.tags.volumePlus");
    expect(text).toContain("scrims.effect.quality delta=+12");
    expect(text).toContain("scrims.effect.players");
  });

  it("shows Push through's condition cost for an ordinary loss", () => {
    show(report());
    expect(describedBy("scrims.decision.pushThrough")).toContain("changes=scrims.effect.condition delta=-6");
  });

  it("charges the higher Push through cost for a severe loss, here a streak of 3", () => {
    show(report(), 3);
    const text = describedBy("scrims.decision.pushThrough");
    expect(text).toContain("scrims.effect.morale delta=-2");
    expect(text).toContain("scrims.effect.condition delta=-8");
    expect(text).toContain("scrims.effect.severeLoss");
  });

  it("shows Cancel scrims' -5 reputation cost on the card without applying or marking anything", () => {
    show(report());
    const text = describedBy("scrims.decision.cancelScrims");
    expect(text).toContain("scrims.effect.cancelStep");
    expect(text).toContain("rep=-5");
    expect(chooseDailyScrimActionMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-slot='scrim-rep-ghost']")).toBeNull();
  });

  it.each([
    ["VodReview", report({ won: false }), 1, ["quality delta=+6", "severity delta=-1", "morale delta=+1", "condition delta=-1", "cancelsNext"]],
    ["MentalReset", report({ won: false }), 1, ["severity delta=-2", "morale delta=+4", "condition delta=+3", "cancelsNext"]],
    ["TargetedDrills", report({ won: false }), 1, ["quality delta=+10", "condition delta=-3", "cancelsNext"]],
  ] as const)("shows the follow-up %s with the engine's numbers and the cancelled block B", (action, current, _streak, expected) => {
    show(current);
    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.cancelScrims" }));
    const names: Record<string, string> = {
      VodReview: "scrims.decision.vodReview",
      MentalReset: "scrims.decision.mentalReset",
      TargetedDrills: "scrims.decision.targetedDrills",
    };
    const text = describedBy(names[action]);
    for (const fragment of expected) expect(text).toContain(fragment);
  });

  it("shows Continue and Offer rest on a won block A, and Day off alone on a won block B", () => {
    show(report({ won: true, severity: 1 }));
    expect(describedBy("scrims.decision.continueBlock2")).toContain("scrims.effect.playsNext");
    expect(describedBy("scrims.decision.offerRest")).toContain("scrims.effect.cancelsNext");
  });
});

describe("one press decides", () => {
  it("calls the backend once with the slot and the action, with no select-then-apply step", async () => {
    chooseDailyScrimActionMock.mockResolvedValue(game());
    show(report());

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.pushThrough" }));

    await waitFor(() => expect(chooseDailyScrimActionMock).toHaveBeenCalledTimes(1));
    expect(chooseDailyScrimActionMock).toHaveBeenCalledWith(0, "PushThrough");
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });

  it("makes no backend call on Cancel scrims, and offers the follow-ups with a way back", async () => {
    show(report());

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.cancelScrims" }));

    expect(chooseDailyScrimActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 2, name: "scrims.cancelFollowupTitle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "scrims.decision.vodReview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "scrims.decision.mentalReset" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "scrims.decision.targetedDrills" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "scrims.backToBlockDecision" }));
    expect(screen.getByRole("heading", { level: 2, name: "scrims.blockDecisionTitle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "scrims.decision.pushThrough" })).toBeInTheDocument();
  });

  it("marks the reputation the follow-up will leave only once Cancel scrims was chosen", () => {
    show(report());
    expect(document.querySelector("[data-slot='scrim-rep-ghost']")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.cancelScrims" }));

    expect(document.querySelector("[data-slot='scrim-rep-ghost']")).not.toBeNull();
    expect(screen.getByText("scrims.repGhostNote value=33")).toBeInTheDocument();
  });
});

describe("the confirmation", () => {
  it("shows what changed from the numbers the game returned, with the costs marked", async () => {
    const decided = report({ post_decision: "DayOff", severity: 0 });
    const updated = game({ scrim_reputation: 33, scrim_weekly_cancellations: 1, scrim_reports: [decided] });
    chooseDailyScrimActionMock.mockResolvedValue(updated);
    const onGameUpdate = show(report({ won: true, severity: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.offerRest" }));

    const list = await screen.findByLabelText("scrims.whatChanged");
    expect(onGameUpdate).toHaveBeenCalledWith(updated);
    expect(within(list).getByText("scrims.reputation").nextElementSibling).toHaveTextContent("38 → 33");
    expect(within(list).getByText("scrims.reputation").nextElementSibling).toHaveTextContent("scrims.costMark");
    expect(within(list).getByText("scrims.cancellations").nextElementSibling).toHaveTextContent("0 → 1");
    expect(within(list).getByText("scrims.effect.severityLabel").nextElementSibling).toHaveTextContent("1 → 0");
    expect(within(list).getByText("scrims.effect.playersLabel").nextElementSibling).toHaveTextContent(
      "scrims.effect.morale delta=+5, scrims.effect.condition delta=+6",
    );
    expect(screen.getByText("scrims.result.blockCancelled")).toBeInTheDocument();
  });

  it("says block 2 was played and its report is waiting after Continue", async () => {
    const decided = report({ won: true, severity: 1, quality: 67, post_decision: "ContinuePlan" });
    const blockTwo = report({ slot_index: 1, opponent_team_id: "northglass", quality: 58, post_decision: null });
    chooseDailyScrimActionMock.mockResolvedValue(game({ scrim_reports: [decided, blockTwo] }));
    show(report({ won: true, severity: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.continueBlock2" }));

    expect(await screen.findByText("scrims.result.blockTwoPlayed")).toBeInTheDocument();
    expect(screen.getByLabelText("scrims.whatChanged")).toHaveTextContent("scrims.result.playedWaiting");
  });

  it("says the next block's report comes with the next advance when the game holds none yet", async () => {
    const decided = report({ won: false, quality: 77, post_decision: "PushThrough" });
    chooseDailyScrimActionMock.mockResolvedValue(game({ scrim_reports: [decided] }));
    show(report());

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.pushThrough" }));

    expect(await screen.findByText("scrims.result.nextReportLater")).toBeInTheDocument();
  });

  it("keeps one live status line, and puts the focus on the heading of the wide column", async () => {
    chooseDailyScrimActionMock.mockResolvedValue(game({ scrim_reports: [report({ post_decision: "PushThrough", quality: 77 })] }));
    show(report());
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.pushThrough" }));

    const heading = await screen.findByRole("heading", { level: 2, name: "scrims.blockDecisionTitle" });
    await waitFor(() => expect(heading).toHaveFocus());
    const live = document.querySelector("[aria-live]") as HTMLElement;
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(live).toHaveTextContent("scrims.reviewDecisionApplied: scrims.decision.pushThrough");
    // The line is a sentence, not a region wrapped around a panel.
    expect(live.querySelector("button, ul, dl")).toBeNull();
  });

  it("places the confirmation right under the heading, before the cards of the next decision", async () => {
    chooseDailyScrimActionMock.mockResolvedValue(game({ scrim_reports: [report({ post_decision: "PushThrough", quality: 77 })] }));
    show(report());

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.pushThrough" }));

    const changes = await screen.findByLabelText("scrims.whatChanged");
    const panel = document.querySelector("[data-slot='scrim-desk-panel']") as HTMLElement;
    const heading = within(panel).getByRole("heading", { level: 2 });
    const firstCard = within(panel).getAllByRole("button")[0];
    // It lives in the same panel as the heading, after it and ahead of every decision card.
    expect(panel).toContainElement(changes);
    expect(heading.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(changes.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("moves the focus to the heading when Cancel scrims opens the follow-ups, and announces the prompt", () => {
    show(report());

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.cancelScrims" }));

    expect(screen.getByRole("heading", { level: 2, name: "scrims.cancelFollowupTitle" })).toHaveFocus();
    expect(document.querySelector("[aria-live]")).toHaveTextContent("scrims.cancelFollowupPrompt");
  });
});

describe("the confirmation after the day moves on", () => {
  it("is dropped, line included, once the date is no longer the day of the decision", async () => {
    chooseDailyScrimActionMock.mockResolvedValue(game({ scrim_reports: [report({ post_decision: "PushThrough", quality: 77 })] }));
    useScrimContextWithFallbackMock.mockReturnValue(decisionContext(report()));
    const { rerender } = render(<ScrimsTabV2 gameState={game()} onGameUpdate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "scrims.decision.pushThrough" }));
    await screen.findByLabelText("scrims.whatChanged");

    const nextDay = { ...game(), clock: { current_date: "2026-03-12" } } as unknown as GameStateData;
    rerender(<ScrimsTabV2 gameState={nextDay} onGameUpdate={vi.fn()} />);

    expect(screen.queryByLabelText("scrims.whatChanged")).toBeNull();
    expect(document.querySelector("[aria-live]")).toBeEmptyDOMElement();
  });
});

describe("the loss streak", () => {
  it("shows from a streak of 1 and not at 0", () => {
    show(report(), 1);
    expect(screen.getAllByText("scrims.lossStreak count=1").length).toBeGreaterThan(0);
  });

  it("is absent without a streak", () => {
    show(report(), 0);
    expect(screen.queryByText(/scrims\.lossStreak/)).toBeNull();
  });
});
