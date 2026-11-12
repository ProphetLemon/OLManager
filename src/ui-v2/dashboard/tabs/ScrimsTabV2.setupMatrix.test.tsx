import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScrimContextResponse } from "@/lib/scrims/scrimContext";
import { useSettingsStore } from "@/store/settingsStore";
import type { GameStateData, TeamData } from "@/store/gameStore";
import { ScrimsTabV2 } from "@/ui-v2/dashboard/tabs/ScrimsTabV2";

const useScrimContextWithFallbackMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (typeof fallback === "string") return fallback;
      if (fallback && typeof fallback === "object" && fallback.defaultValue) return fallback.defaultValue;
      return key;
    },
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/services/trainingService", () => ({
  chooseDailyScrimAction: vi.fn(),
  getScrimContext: vi.fn(),
  saveWeeklyScrimPlans: vi.fn(),
  setWeeklyScrimObjective: vi.fn(),
  setWeeklyScrimSlots: vi.fn(),
}));

vi.mock("@/hooks/useScrimContextWithFallback", () => ({
  useScrimContextWithFallback: (...args: unknown[]) => useScrimContextWithFallbackMock(...args),
}));

const GAME = {
  manager: { team_id: "mine" },
  teams: [
    { id: "mine", name: "Mine", short_name: "MIN", scrim_weekly_slots: 2, starting_xi_ids: [], form: [], history: [] },
    { id: "rival", name: "Rival", short_name: "RIV", starting_xi_ids: [], form: [], history: [] },
  ] as unknown as TeamData[],
  players: [],
  clock: { current_date: "2027-01-01" },
  day_phase: "Morning",
} as unknown as GameStateData;

type SlotPattern = "open" | "mixed" | "passed";

const SLOT_PATTERNS: Record<SlotPattern, boolean[]> = {
  open: [true, true],
  mixed: [false, true],
  passed: [false, false],
};

function slot(index: number, canEdit: boolean) {
  return {
    slotIndex: index,
    weekday: index * 2,
    label: "Mon",
    labelDay: index * 2,
    labelSuffix: "",
    plan: [],
    resolvedOpponentTeamId: null,
    resultWon: null,
    report: null,
    status: canEdit ? "Open" : "Locked",
    canEdit,
  };
}

function context(pattern: SlotPattern, lock: string | null | "none"): ScrimContextResponse {
  const locked = lock !== "none";
  return {
    today: {
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
    },
    week: {
      weekKey: "2026-W53",
      objective: null,
      capacity: 2,
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
      setupLocked: locked,
      setupLockedReason: locked ? lock : null,
      canFinalizeSetup: true,
      slots: SLOT_PATTERNS[pattern].map((canEdit, index) => slot(index, canEdit)),
      latestReports: [],
    },
  } as unknown as ScrimContextResponse;
}

function setMode(mode: "manual" | "assistant") {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, scrim_review_mode: mode } });
}

function formDisabled(): boolean {
  const selects = screen.queryAllByRole("combobox");
  const autofill = screen.getByRole("button", { name: /training\.scrims\.autofill/ });
  return (autofill as HTMLButtonElement).disabled || selects.some((select) => (select as HTMLSelectElement).disabled);
}

// Every state that disables the weekly form, by delegation mode, lock state and slot days left.
const LOCKS: Array<[string, string | null | "none"]> = [
  ["no lock", "none"],
  ["manual lock", "manual"],
  ["week_started lock", "week_started"],
  ["first_scrim_window lock", "first_scrim_window"],
  ["unknown lock reason", "future_reason"],
  ["lock without a reason", null],
];

function expectedKey(mode: string, pattern: SlotPattern, lock: string | null | "none"): string | null {
  if (mode === "assistant") return "scrims.assistantHandling";
  if (lock !== "none") {
    const known: Record<string, string> = {
      manual: "scrims.setupLockedManual",
      week_started: "scrims.setupLockedWeekStarted",
      first_scrim_window: "scrims.setupLockedFirstWindow",
    };
    return (lock && known[lock]) || "scrims.setupLocked";
  }
  if (pattern === "passed") return "scrims.setupAllSlotsPassed";
  if (pattern === "mixed") return "scrims.setupSomeSlotsPassed";
  return null;
}

describe("the weekly scrim form never stays disabled without saying why", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMode("manual");
  });

  const rows = (["manual", "assistant"] as const).flatMap((mode) =>
    (Object.keys(SLOT_PATTERNS) as SlotPattern[]).flatMap((pattern) =>
      LOCKS.map(([lockName, lock]) => [mode, pattern, lockName, lock] as const),
    ),
  );

  it.each(rows)("%s mode, slots %s, %s", (mode, pattern, _lockName, lock) => {
    setMode(mode);
    useScrimContextWithFallbackMock.mockReturnValue(context(pattern, lock));

    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);

    const key = expectedKey(mode, pattern, lock);
    if (formDisabled()) {
      expect(key, "the form is disabled, so a reason must be expected").not.toBeNull();
    }
    if (key === null) {
      expect(formDisabled()).toBe(false);
      expect(screen.queryByRole("status")).toBeNull();
    } else {
      expect(screen.getByRole("status")).toHaveTextContent(key);
    }
  });

  it("shows the reason of a lock right after the delegation is switched to manual", async () => {
    setMode("assistant");
    useScrimContextWithFallbackMock.mockReturnValue(context("passed", "first_scrim_window"));
    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("scrims.assistantHandling");

    fireEvent.click(screen.getByRole("button", { name: "scrims.assistantLabel" }));

    await waitFor(() => expect(useSettingsStore.getState().settings.scrim_review_mode).toBe("manual"));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("scrims.setupLockedFirstWindow");
    expect(within(status).queryByText("scrims.assistantHandling")).toBeNull();
    expect(formDisabled()).toBe(true);
  });

  it("opens the form right after the delegation is switched to manual when nothing locks it", async () => {
    setMode("assistant");
    useScrimContextWithFallbackMock.mockReturnValue(context("open", "none"));
    render(<ScrimsTabV2 gameState={GAME} onGameUpdate={vi.fn()} />);
    expect(formDisabled()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "scrims.assistantLabel" }));

    await waitFor(() => expect(formDisabled()).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
