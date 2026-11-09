import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LineupPlate, ScoreboardData, SideData } from "@/lib/home/scoreboard";
import { ScoreboardHero, shortNameSizeClass } from "./ScoreboardHero";

// Honour defaultValue, interpolation and the _one/_other plural of the real i18next.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, opts?: Record<string, unknown>) => {
      const template = typeof opts?.defaultValue === "string" ? opts.defaultValue : key;
      return template.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(opts?.[name] ?? ""));
    },
  }),
}));

const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;

function lineup(prefix: string, empty: string[] = []): LineupPlate[] {
  return ROLES.map((role, index) => ({
    role,
    playerId: empty.includes(role) ? null : `${prefix}-${role}`,
    name: empty.includes(role) ? "—" : `${prefix} ${role.toLowerCase()}`,
    ovr: empty.includes(role) ? null : 70 + index,
    photo: null,
  }));
}

function side(overrides: Partial<SideData> & { prefix: string }): SideData {
  const { prefix, ...rest } = overrides;
  return {
    teamId: prefix,
    name: `${prefix} Esports`,
    shortName: prefix.toUpperCase().slice(0, 3),
    logoUrl: null,
    palette: { accent: "#ffd400", accentText: "#ffe066", foreground: "#0a0a0a", secondary: null, source: "badge" },
    lineup: lineup(prefix),
    lineupOvr: 72,
    form: [],
    ...rest,
  };
}

function makeData(overrides: Partial<ScoreboardData> = {}): ScoreboardData {
  return {
    fixtureId: "f1",
    date: "2027-12-28",
    matchday: 3,
    isHome: true,
    kind: "League",
    bestOf: null,
    competitionName: "LEC",
    season: 2028,
    daysToGo: 84,
    you: side({ prefix: "Bar", name: "Barcelona Esports", shortName: "BAR" }),
    opponent: side({ prefix: "Navi", name: "Natus Vincere", shortName: "NAVI" }),
    ...overrides,
  };
}

function renderHero(data: ScoreboardData | null, handlers = { onOpenSchedule: vi.fn(), onOpenSquad: vi.fn() }) {
  return { ...render(<ScoreboardHero data={data} {...handlers} />), handlers };
}

describe("ScoreboardHero", () => {
  it("is a region named by its heading", () => {
    renderHero(makeData());
    expect(screen.getByRole("region", { name: "Next Match" })).toBeInTheDocument();
  });

  it.each([
    ["League", "Matchday 3"],
    ["Friendly", "Friendly"],
    ["PreseasonTournament", "Preseason Tournament"],
    ["Playoffs", "Playoffs"],
  ] as const)("labels a %s fixture", (kind, label) => {
    renderHero(makeData({ kind, bestOf: kind === "Playoffs" ? 5 : null }));
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute("data-kind", kind);
  });

  it("shows the best-of tag only for playoffs", () => {
    const { unmount } = renderHero(makeData({ kind: "Playoffs", bestOf: 5 }));
    expect(screen.getByText("Best of 5")).toBeInTheDocument();
    unmount();
    renderHero(makeData({ kind: "League", bestOf: 3 }));
    expect(screen.queryByText("Best of 3")).toBeNull();
  });

  it("uses the vs word at home and the at word away", () => {
    const { unmount } = renderHero(makeData({ isHome: true }));
    expect(screen.getByText("vs NAVI")).toBeInTheDocument();
    unmount();
    renderHero(makeData({ isHome: false }));
    expect(screen.getByText("at NAVI")).toBeInTheDocument();
  });

  it("uses singular and plural days to go", () => {
    const { unmount } = renderHero(makeData({ daysToGo: 1 }));
    expect(screen.getByText("1 day to go")).toBeInTheDocument();
    unmount();
    renderHero(makeData({ daysToGo: 84 }));
    expect(screen.getByText("84 days to go")).toBeInTheDocument();
  });

  it("shows a match day tag instead of a countdown on day zero", () => {
    renderHero(makeData({ daysToGo: 0 }));
    expect(screen.getByText("Match day")).toBeInTheDocument();
    expect(screen.queryByText(/to go/)).toBeNull();
    expect(screen.getByRole("region")).toHaveAttribute("data-match-day", "true");
  });

  it("renders five role plates per side and a dash for an empty role", () => {
    renderHero(makeData({ opponent: side({ prefix: "Navi", name: "Natus Vincere", shortName: "NAVI", lineup: lineup("Navi", ["JUNGLE"]) }) }));
    const lists = screen.getAllByRole("list");
    const yours = within(lists[0]).getAllByRole("listitem");
    const theirs = within(lists[1]).getAllByRole("listitem");
    expect(yours).toHaveLength(5);
    expect(theirs).toHaveLength(5);
    const empty = theirs[1];
    expect(empty).toHaveAttribute("data-empty", "true");
    expect(empty).toHaveTextContent("—");
    expect(within(empty).getByText("Not set")).toHaveClass("sr-only");
  });

  it("truncates a 39 character name with a title on the full name", () => {
    const longName = "Extraordinarily Long Esports Club Name";
    expect(longName.length).toBeGreaterThanOrEqual(38);
    renderHero(makeData({ opponent: side({ prefix: "Navi", name: longName, shortName: "ELECN" }) }));
    const caption = screen.getAllByTitle(longName).find((node) => node.tagName === "P");
    expect(caption).toHaveClass("truncate");
  });

  it("shrinks the short name by length", () => {
    expect(shortNameSizeClass("BAR")).toContain("text-scoreboard");
    expect(shortNameSizeClass("NAVI")).not.toBe(shortNameSizeClass("BAR"));
    const nine = shortNameSizeClass("ABCDEFGHI");
    expect(nine).toContain("text-[2rem]");
    expect(nine).not.toContain("text-scoreboard");
  });

  it("shows the opponent form with text for every result", () => {
    renderHero(makeData({ opponent: side({ prefix: "Navi", name: "Natus Vincere", shortName: "NAVI", form: ["W", "L", "D"] }) }));
    const form = screen.getByRole("list", { name: "Opponent form" });
    expect(within(form).getAllByRole("listitem")).toHaveLength(3);
    expect(within(form).getByText("Win")).toBeInTheDocument();
    expect(within(form).getByText("Loss")).toBeInTheDocument();
  });

  it("shows the after-first-match line for a new opponent", () => {
    renderHero(makeData());
    expect(screen.getByText("Natus Vincere's form appears after their first match")).toBeInTheDocument();
  });

  it("scopes the opponent colours to the section", () => {
    renderHero(makeData());
    const section = screen.getByRole("region");
    expect(section.style.getPropertyValue("--side-accent")).toBe("#ffd400");
    expect(section.style.getPropertyValue("--side-foreground")).toBe("#0a0a0a");
    expect(section.style.getPropertyValue("--side-secondary")).toBe("#ffd400");
  });

  it("drops the wedges in high contrast and hides decorative shields", () => {
    const { container } = renderHero(makeData());
    for (const wedge of container.querySelectorAll('[data-slot^="wedge-"]')) {
      expect(wedge).toHaveAttribute("aria-hidden", "true");
      expect(wedge.className).toContain("[[data-contrast=high]_&]:hidden");
    }
    for (const shield of container.querySelectorAll('[data-slot="club-shield"]')) {
      expect(shield).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("uses rem sizes only", () => {
    const { container } = renderHero(makeData());
    expect(container.innerHTML).not.toMatch(/text-\[\d+(\.\d+)?px\]/);
  });

  it("fires the schedule and squad actions", () => {
    const { handlers } = renderHero(makeData());
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    fireEvent.click(screen.getByRole("button", { name: "Squad" }));
    expect(handlers.onOpenSchedule).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSquad).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state without data", () => {
    renderHero(null);
    expect(screen.getByText("No fixtures scheduled")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
