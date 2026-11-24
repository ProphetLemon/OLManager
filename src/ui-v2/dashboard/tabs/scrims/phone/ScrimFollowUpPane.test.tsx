import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ScrimFollowUpPane, type ScrimFollowUpPaneProps } from "./ScrimFollowUpPane";
import { makeOptions, makeReport } from "./scrimDayFixtures";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function setup(props: Partial<ScrimFollowUpPaneProps> = {}) {
  const onDecide = vi.fn();
  const onBack = vi.fn();
  const utils = render(
    <ScrimFollowUpPane
      title="Cancel scrims"
      onBack={onBack}
      report={makeReport()}
      options={makeOptions({ isFirstBlock: true, won: false, showCancelFollowups: true })}
      savingId={null}
      onDecide={onDecide}
      {...props}
    />,
  );
  return { onDecide, onBack, ...utils };
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-slot="effects-row"]')];
const names = () => rows().map((row) => row.querySelector("button span")?.textContent);

describe("ScrimFollowUpPane", () => {
  it("draws the shared frame titled Cancel scrims, with one heading", () => {
    setup();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: /Cancel scrims/ })).toHaveAttribute("data-pane-heading", "");
    expect(document.querySelector('[data-slot="scrim-view-body"]')?.className).not.toContain("bg-card");
  });

  it("puts the cost mark and the sentence of what any follow-up cancels in the top row, once", () => {
    setup();
    const top = document.querySelector('[data-slot="scrim-view-top"]') as HTMLElement;
    const cost = document.querySelector('[data-slot="followup-cost"]') as HTMLElement;
    expect(top).toContainElement(cost);
    expect(within(cost).getByText("Cost")).toBeInTheDocument();
    expect(screen.getAllByText(/Cancels block B\. Scrim rep -5, cancellations \+1\./)).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="cost-mark"]')).toHaveLength(1);
  });

  it("says the prompt sentence, then one row per follow-up the game gives", () => {
    setup();
    expect(screen.getByText("Scrims cancelled. Pick a follow-up.")).toBeInTheDocument();
    expect(names()).toEqual(["VOD Review", "Mental Reset", "Targeted Drills"]);
  });

  it("draws one, two or three rows without leaving any out", () => {
    const all = makeOptions({ isFirstBlock: true, won: false, showCancelFollowups: true });
    for (const count of [1, 2, 3]) {
      const { unmount } = setup({ options: all.slice(0, count) });
      expect(rows()).toHaveLength(count);
      unmount();
    }
  });

  it("puts the ? glossary at the right end of the top row", () => {
    setup();
    const top = document.querySelector('[data-slot="scrim-view-top"]') as HTMLElement;
    const controls = [...top.querySelectorAll("button")];
    expect(controls[controls.length - 1]).toBe(within(top).getByRole("button", { name: "What each number means" }));
  });

  it("uses the same table as the decision: header once, rows as buttons, a fixed column per stat, no Severity", () => {
    setup();
    expect(document.querySelectorAll('[data-slot="effects-header"]')).toHaveLength(1);
    // Body 234 - 8 = 226: the prompt (about 30) + 22 + 3 x 48 + 2 x 4 = 204, so the table fits and its rows grow into the rest.
    const vod = rows()[0];
    expect(vod).toHaveTextContent("Review VOD to extract concrete learning");
    const quality = vod.querySelector('[data-stat="quality"] [data-slot="stat-value"]') as HTMLElement;
    expect(quality).toHaveTextContent("+6");
    expect(quality).toHaveTextContent("\u2192 67");
    expect(vod.querySelector('[data-stat="energy"] [data-slot="stat-value"]')).toHaveAttribute("data-change", "down");
    expect(vod).not.toHaveTextContent(/Severity/i);
    expect(vod).not.toHaveTextContent("Picked players");
    expect(vod).not.toHaveTextContent("Cancels block B");
    expect(vod).not.toHaveTextContent("The day closes");
    expect(vod.querySelector('[data-slot="followup-chevron"]')).not.toBeNull();
  });

  it("marks a drop with the down arrow and the amber, and names the row in words", () => {
    setup();
    const drills = rows()[2];
    const energy = drills.querySelector('[data-stat="energy"] [data-slot="stat-value"]') as HTMLElement;
    expect(energy.className).toContain("text-warning");
    expect(energy.querySelector(".lucide-arrow-down")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Targeted Drills. Quality goes up 10, ends at 71. Morale: no change. Energy goes down 3." })).toBeInTheDocument();
  });

  it("makes each row one real button of at least a target that chooses on one press", () => {
    const { onDecide } = setup();
    for (const row of rows()) {
      expect(row.className).toContain("min-h-[var(--hit)]");
      expect(row.querySelectorAll("button")).toHaveLength(1);
    }
    fireEvent.click(screen.getByRole("button", { name: /^Targeted Drills\./ }));
    expect(onDecide).toHaveBeenCalledWith("TargetedDrills");
  });

  it("goes back to the decision through the frame's back control, and has no pinned Back of its own", () => {
    const { onBack } = setup();
    expect(screen.queryByRole("button", { name: /Back to block decision/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back: Cancel scrims" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says Saving on the row that saves and makes the rows aria-disabled but focusable and unpressable", () => {
    const { onDecide } = setup({ savingId: "MentalReset" });
    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
    for (const name of [/^VOD Review\./, /^Targeted Drills\./]) {
      const row = screen.getByRole("button", { name });
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(row).not.toBeDisabled();
      fireEvent.click(row);
    }
    expect(onDecide).not.toHaveBeenCalled();
    for (const row of rows()) expect(row.querySelector("button")!.className).not.toMatch(/opacity/);
  });

  it("has no live region and nothing that scrolls", () => {
    const { container } = setup();
    expect(container.querySelector("[aria-live]")).toBeNull();
    // The frame's body may scroll as a safety; nothing inside the pane does.
    expect(container.querySelector('[data-slot="scrim-followup-pane"]')!.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"]')).toBeNull();
  });
});
