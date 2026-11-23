import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ScrimFollowUpPane, type ScrimFollowUpPaneProps } from "./ScrimFollowUpPane";
import { makeOptions } from "./scrimDayFixtures";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function setup(props: Partial<ScrimFollowUpPaneProps> = {}) {
  const onDecide = vi.fn();
  const onBack = vi.fn();
  const utils = render(
    <ScrimFollowUpPane
      options={makeOptions({ isFirstBlock: true, won: false, showCancelFollowups: true })}
      savingId={null}
      onDecide={onDecide}
      onBack={onBack}
      {...props}
    />,
  );
  return { onDecide, onBack, ...utils };
}

describe("ScrimFollowUpPane", () => {
  it("is titled Cancelled, choose follow-up, and that heading names the pane", () => {
    setup();
    const heading = screen.getByRole("heading", { level: 2, name: "Cancelled — choose follow-up" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("group", { name: "Cancelled — choose follow-up" })).toBeInTheDocument();
  });

  it("says the cost once, with the Cost mark, and not again in every row", () => {
    const { container } = setup();
    expect(screen.getAllByText("Cancels block B. Scrim rep -5, cancellations +1.")).toHaveLength(1);
    const marks = container.querySelectorAll('[data-slot="cost-mark"]');
    expect(marks).toHaveLength(1);
  });

  it("offers the three follow-ups as rows with their tags and effect lines", () => {
    setup();
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["VOD Review", "Mental Reset", "Targeted Drills", "Back to block decision"]);
    const vod = screen.getByRole("button", { name: "VOD Review" }).closest("li") as HTMLElement;
    expect(vod).toHaveAttribute("data-layout", "row");
    expect(vod).toHaveTextContent("+Analysis");
    expect(vod).toHaveTextContent("Report quality +6");
    expect(vod).toHaveTextContent("Severity -1");
    expect(vod).toHaveTextContent("Picked players: Morale +1, Condition -1");
    expect(vod.className).toContain("min-h-[3.75rem]");
    // the heading already says that block B is cancelled and the day closes
    expect(vod).not.toHaveTextContent("Cancels block B");
    expect(vod).not.toHaveTextContent("The day closes");
  });

  it("decides with one press", () => {
    const { onDecide } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Targeted Drills" }));
    expect(onDecide).toHaveBeenCalledWith("TargetedDrills");
  });

  it("pins Back to the bottom, outside the part that scrolls, at least 48 px high", () => {
    const { container, onBack } = setup();
    const back = screen.getByRole("button", { name: "Back to block decision" });
    const scroller = container.querySelector('[data-slot="decision-scroll"]') as HTMLElement;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller).not.toContainElement(back);
    expect(back.className).toContain("h-[var(--hit)]");
    expect(container.querySelector('[data-slot="scrim-followup-pane"]')?.lastElementChild).toBe(back);
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says Saving on the row that saves and makes the rows aria-disabled, Back stays usable", () => {
    const { onDecide, onBack } = setup({ savingId: "MentalReset" });
    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
    for (const name of ["VOD Review", "Targeted Drills"]) {
      const row = screen.getByRole("button", { name });
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(row).not.toBeDisabled();
      fireEvent.click(row);
    }
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(within(document.body).getByRole("button", { name: "Back to block decision" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("has no live region of its own", () => {
    const { container } = setup();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});
