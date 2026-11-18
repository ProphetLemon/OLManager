import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LanePill } from "@/lib/dashboard/attentionLane";
import type { CallItem } from "@/lib/dashboard/needsYourCall";

import { AttentionLaneV2 } from "./AttentionLaneV2";
import { MAIN_CONTENT_ID } from "./focusMainContent";

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return { useTranslation: () => ({ t: translateFromEnglish, i18n: { language: "en" } }) };
});

const scrims: CallItem = {
  id: "blocker:scrim_setup_required",
  kind: "blocker",
  severity: "soft",
  tagKey: "onAir.tags.blocker",
  tagTone: "warning",
  headline: "No scrims planned for Thursday",
  actionLabelKey: "onAir.calls.actions.openScrims",
  target: { tab: "Scrims" },
};
const lineup: CallItem = {
  id: "blocker:incomplete_lineup",
  kind: "blocker",
  severity: "hard",
  tagKey: "onAir.tags.blocker",
  tagTone: "negative",
  headline: "Starting five is incomplete",
  actionLabelKey: "onAir.calls.actions.fixLineup",
  target: { tab: "Squad" },
};
const renewal: CallItem = {
  id: "contract:p1",
  kind: "contract",
  severity: "soft",
  tagKey: "onAir.tags.contract",
  tagTone: "warning",
  headline: "Faker's contract ends in 20 days",
  actionLabelKey: "onAir.calls.actions.renew",
  target: { tab: "Squad", context: { playerId: "p1" } },
};

function pillsOf(items: CallItem[], count = items.length): LanePill[] {
  return [
    ...items.map((item): LanePill => ({ kind: "call", id: item.id, item })),
    { kind: "home", id: "lane:home", count },
  ];
}

const handlers = { onNavigate: vi.fn(), onShowAll: vi.fn() };

function Frame({
  pills = pillsOf([scrims, lineup, renewal]),
  show = true,
  platform = "desktop",
}: {
  pills?: LanePill[];
  show?: boolean;
  platform?: "desktop" | "android";
}) {
  return (
    <>
      <button type="button">elsewhere</button>
      {show && <AttentionLaneV2 pills={pills} platform={platform} {...handlers} />}
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        content
      </main>
    </>
  );
}

const toolbar = () => screen.getByRole("toolbar");
const pillButtons = () => within(toolbar()).getAllByRole("button");
const lastPill = () => pillButtons()[pillButtons().length - 1];
const focused = () => document.activeElement;

beforeEach(() => {
  handlers.onNavigate.mockReset();
  handlers.onShowAll.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("AttentionLaneV2 (R24, R47)", () => {
  it("is a region named Before you continue, holding one toolbar that does not repeat the name", () => {
    render(<Frame />);
    const region = screen.getByRole("region", { name: "Before you continue" });
    const bar = within(region).getByRole("toolbar");
    expect(bar).toHaveAttribute("aria-orientation", "horizontal");
    expect(bar).not.toHaveAttribute("aria-labelledby");
    expect(bar).not.toHaveAttribute("aria-label");
    expect(within(region).getByRole("heading", { level: 2, name: "Before you continue" })).toBeVisible();
  });

  it("keeps the heading for screen readers only on Android", () => {
    render(<Frame platform="android" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveClass("sr-only");
  });

  it("is a single Tab stop: exactly one pill has tabIndex 0", () => {
    render(<Frame />);
    const stops = pillButtons().filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(pillButtons()[0]);
  });

  it("does not take focus when it appears", () => {
    render(<Frame show={false} />);
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    act(() => elsewhere.focus());
    const view = render(<Frame />);
    expect(focused()).toBe(elsewhere);
    view.unmount();
  });

  it("moves between pills with Right, Left, Home and End", () => {
    render(<Frame />);
    const pills = pillButtons();
    act(() => pills[0].focus());

    fireEvent.keyDown(focused()!, { key: "ArrowRight" });
    expect(focused()).toBe(pills[1]);
    fireEvent.keyDown(focused()!, { key: "ArrowLeft" });
    expect(focused()).toBe(pills[0]);
    fireEvent.keyDown(focused()!, { key: "End" });
    expect(focused()).toBe(pills[3]);
    fireEvent.keyDown(focused()!, { key: "Home" });
    expect(focused()).toBe(pills[0]);
    expect(pills.filter((b) => b.tabIndex === 0)).toEqual([pills[0]]);
  });

  it("continues from a clicked pill", () => {
    render(<Frame />);
    const pills = pillButtons();
    act(() => pills[2].focus());
    fireEvent.keyDown(pills[2], { key: "ArrowLeft" });
    expect(focused()).toBe(pills[1]);
  });

  it("names a pill by its tag, headline and action", () => {
    render(<Frame />);
    expect(pillButtons()[0]).toHaveAccessibleName("Blocker: No scrims planned for Thursday. Open scrims");
    expect(pillButtons()[2]).toHaveAccessibleName("Contract: Faker's contract ends in 20 days. Renew");
  });

  it("runs the call's action on Enter, once", () => {
    render(<Frame />);
    const pills = pillButtons();
    act(() => pills[0].focus());
    fireEvent.keyDown(pills[0], { key: "Enter" });
    expect(handlers.onNavigate).toHaveBeenCalledTimes(1);
    expect(handlers.onNavigate).toHaveBeenCalledWith({ kind: "tab", tab: "Scrims", context: undefined });
  });

  it("opens a renewal on its player's profile from a click", () => {
    render(<Frame />);
    fireEvent.click(pillButtons()[2]);
    expect(handlers.onNavigate).toHaveBeenCalledWith({ kind: "player", id: "p1", openRenewal: true });
  });

  it("ends with one pill for Home that counts every decision and shows them all there", () => {
    render(<Frame pills={pillsOf([scrims, lineup], 3)} />);
    const home = lastPill();
    expect(home).toHaveAccessibleName("All 3 on Home");
    act(() => home.focus());
    fireEvent.keyDown(home, { key: " " });
    expect(handlers.onShowAll).toHaveBeenCalledTimes(1);
    expect(handlers.onNavigate).not.toHaveBeenCalled();
  });

  it("says See it on Home for a single decision", () => {
    render(<Frame pills={pillsOf([lineup])} />);
    expect(lastPill()).toHaveAccessibleName("See it on Home");
  });

  it("moves focus to the main region when it goes away with focus inside", () => {
    const view = render(<Frame />);
    act(() => pillButtons()[1].focus());
    view.rerender(<Frame show={false} />);
    expect(focused()).toBe(document.getElementById(MAIN_CONTENT_ID));
  });

  it("leaves focus alone when it goes away with focus elsewhere", () => {
    const view = render(<Frame />);
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    act(() => elsewhere.focus());
    view.rerender(<Frame show={false} />);
    expect(focused()).toBe(elsewhere);
  });

  it("moves focus to the pill now at the same place when the focused pill goes (R47)", () => {
    const view = render(<Frame />);
    act(() => pillButtons()[1].focus());
    view.rerender(<Frame pills={pillsOf([scrims, renewal])} />);
    expect(focused()).toHaveAccessibleName("Contract: Faker's contract ends in 20 days. Renew");
    expect(pillButtons().filter((b) => b.tabIndex === 0)).toEqual([focused()]);
  });

  it("scrolls the pill it moves focus to into view (R59)", () => {
    const view = render(<Frame />);
    act(() => pillButtons()[1].focus());
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    view.rerender(<Frame pills={pillsOf([scrims, renewal])} />);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const contexts = vi.mocked(Element.prototype.scrollIntoView).mock.contexts;
    expect(contexts[contexts.length - 1]).toBe(focused());
  });

  it("leaves focus on the page when the user had already left the pill that goes (R59)", () => {
    const view = render(<Frame />);
    act(() => pillButtons()[1].focus());
    act(() => (document.activeElement as HTMLElement).blur());
    view.rerender(<Frame pills={pillsOf([scrims, renewal])} />);
    expect(focused()).toBe(document.body);
  });

  it("keeps the Tab stop on the focused pill when an earlier pill goes", () => {
    const view = render(<Frame />);
    act(() => pillButtons()[2].focus());
    view.rerender(<Frame pills={pillsOf([lineup, renewal])} />);
    expect(focused()).toHaveAccessibleName("Contract: Faker's contract ends in 20 days. Renew");
    expect(pillButtons().filter((b) => b.tabIndex === 0)).toEqual([focused()]);
  });

  it("does not pull focus back when a pill goes while focus is elsewhere", () => {
    const view = render(<Frame />);
    act(() => pillButtons()[1].focus());
    const main = document.getElementById(MAIN_CONTENT_ID)!;
    act(() => main.focus());
    view.rerender(<Frame pills={pillsOf([scrims, renewal])} />);
    expect(focused()).toBe(main);
  });

  it("never makes the scroller a Tab stop, and Enter on it activates nothing (R61)", () => {
    render(<Frame />);
    const scroller = document.querySelector<HTMLElement>('[data-slot="lane-scroller"]')!;
    expect(scroller).toHaveAttribute("tabindex", "-1");
    act(() => scroller.focus());
    fireEvent.keyDown(scroller, { key: "Enter" });
    fireEvent.keyDown(scroller, { key: " " });
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    expect(handlers.onShowAll).not.toHaveBeenCalled();
  });

  it("keeps the whole focus ring inside a pill and clear of the fades (R47)", () => {
    render(<Frame />);
    for (const pill of pillButtons()) expect(pill).toHaveClass("focus-visible:ring-inset");
    expect(document.querySelector('[data-slot="lane-scroller"]')).toHaveClass("scroll-px-6");
    // overflow-x-auto turns overflow-y to auto, which would clip a pill by its 1 px and scroll it (R62).
    expect(document.querySelector('[data-slot="lane-scroller"]')).toHaveClass("overflow-y-hidden");
  });

  it("sets headlines in text-entry and the action in the club text colour (R35)", () => {
    render(<Frame />);
    const pill = pillButtons()[0];
    expect(pill.querySelector('[data-slot="lane-headline"]')).toHaveClass("text-entry");
    expect(pill.querySelector('[data-slot="lane-action"]')).toHaveClass("text-club-text");
    expect(pill.querySelector('[data-slot="tag-block"]')).toHaveClass("text-nav");
  });
});
