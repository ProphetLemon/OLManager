import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScrimResultNoticeV2 } from "./ScrimResultNoticeV2";

function renderNotice(props: Partial<Parameters<typeof ScrimResultNoticeV2>[0]> = {}) {
  const onOpenScrims = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ScrimResultNoticeV2
      lines={["Won against Rivals"]}
      assistantNote={null}
      onOpenScrims={onOpenScrims}
      onDismiss={onDismiss}
      {...props}
    />,
  );
  return { onOpenScrims, onDismiss };
}

describe("ScrimResultNoticeV2", () => {
  it("renders nothing visible and an empty live region without a notice", () => {
    renderNotice({ lines: null });

    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("states the result in words, in a polite live region", () => {
    renderNotice({ lines: ["Won against Rivals", "Lost against Others"] });

    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Scrim results. Won against Rivals. Lost against Others");
    expect(screen.getByRole("region", { name: "Scrim results" })).toHaveTextContent("Lost against Others");
  });

  it("uses the singular title for one scrim", () => {
    renderNotice();

    expect(screen.getByRole("region", { name: "Scrim result" })).toBeInTheDocument();
  });

  it("shows the Assistant Coach note inside the same notice", () => {
    renderNotice({ assistantNote: "Assistant Coach resolved the post-scrim decision." });

    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region")).toHaveTextContent("Assistant Coach resolved the post-scrim decision.");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("offers a way to open the Scrims tab and to dismiss, without taking focus", () => {
    const { onOpenScrims, onDismiss } = renderNotice();

    expect(document.body).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Open Scrims" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onOpenScrims).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
