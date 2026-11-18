import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { WorldOverlayInfo } from "@/services/worldOverlayService";
import type { RosterUpdateStatus } from "@/store/rosterUpdateStore";

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return {
    initReactI18next: { type: "3rdParty", init: vi.fn() },
    useTranslation: () => ({ i18n: { language: "en" }, t: translateFromEnglish }),
  };
});

import { RosterOverlayPanel } from "./RosterOverlayPanel";

function makeInfo(overrides: Partial<WorldOverlayInfo> = {}): WorldOverlayInfo {
  return {
    as_of: "2026-06-22",
    origin: "bundled",
    source: {
      name: "Leaguepedia",
      url: "https://lol.fandom.com",
      license: "CC BY-SA 3.0",
      license_url: "https://www.fandom.com/licensing",
      attribution: "Roster data from Leaguepedia, available under CC BY-SA 3.0.",
    },
    player_ops: 12,
    staff_ops: 3,
    updated: false,
    ...overrides,
  };
}

const STATUSES: RosterUpdateStatus[] = ["idle", "checking", "updated", "upToDate", "failed"];

function renderPanel(
  status: RosterUpdateStatus,
  info: WorldOverlayInfo | null = makeInfo(),
  onRetry: () => void = () => {},
) {
  return render(<RosterOverlayPanel info={info} status={status} onRetry={onRetry} />);
}

const statusLine = () => screen.getByTestId("roster-status");
const announcer = () => screen.getByRole("status");

/** Render, then move through `steps` (status, and info when it changes). */
function renderSteps(
  first: RosterUpdateStatus,
  steps: Array<[RosterUpdateStatus, (WorldOverlayInfo | null)?]>,
  firstInfo: WorldOverlayInfo | null = makeInfo(),
) {
  const panel = (status: RosterUpdateStatus, info: WorldOverlayInfo | null) => (
    <RosterOverlayPanel info={info} status={status} onRetry={() => {}} />
  );
  const view = render(panel(first, firstInfo));
  let info = firstInfo;
  for (const [status, nextInfo] of steps) {
    if (nextInfo !== undefined) info = nextInfo;
    view.rerender(panel(status, info));
  }
  return view;
}

describe("RosterOverlayPanel", () => {
  it.each(STATUSES)("has no Update rosters button when the check is %s", (status) => {
    renderPanel(status);

    expect(screen.queryByRole("button", { name: /update rosters/i })).not.toBeInTheDocument();
  });

  it.each(["idle", "upToDate"] as const)("shows the date a new game will use when %s", (status) => {
    renderPanel(status);

    expect(statusLine()).toHaveTextContent(/^Rosters as of June 22, 2026$/);
  });

  it("says it is checking while a check runs, and keeps the date", () => {
    renderPanel("checking");

    expect(statusLine()).toHaveTextContent("Rosters as of June 22, 2026");
    expect(statusLine()).toHaveTextContent("Checking for roster updates…");
  });

  it("shows the new date after an update", () => {
    renderPanel("updated", makeInfo({ as_of: "2026-11-01", origin: "downloaded", updated: true }));

    expect(statusLine()).toHaveTextContent(/^Rosters updated to November 1, 2026$/);
  });

  it("says the check failed, keeps the date and offers a real Retry button", () => {
    const onRetry = vi.fn();
    renderPanel("failed", makeInfo(), onRetry);

    expect(statusLine()).toHaveTextContent("Rosters as of June 22, 2026");
    expect(statusLine()).toHaveTextContent("Couldn't check for roster updates");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.tagName).toBe("BUTTON");
    expect(retry).toHaveAccessibleDescription("Couldn't check for roster updates");

    fireEvent.click(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  describe("Retry during and after the retry", () => {
    const retryButton = () => screen.getByRole("button", { name: "Retry" });
    const panel = (status: RosterUpdateStatus, onRetry: () => void = () => {}) => (
      <RosterOverlayPanel info={makeInfo()} status={status} onRetry={onRetry} />
    );

    it("leaves focus on Retry when it is pressed", () => {
      renderPanel("failed");
      act(() => retryButton().focus());

      fireEvent.click(retryButton());

      expect(retryButton()).toHaveFocus();
    });

    it("stays in place while the retry runs, marked unavailable but still focusable", () => {
      const { rerender } = render(panel("failed"));
      const retry = retryButton();

      rerender(panel("checking"));

      expect(retryButton()).toBe(retry);
      expect(retry).toHaveAttribute("aria-disabled", "true");
      expect(retry).not.toBeDisabled();
    });

    it("keeps focus on Retry while the retry runs", () => {
      const { rerender } = render(panel("failed"));
      act(() => retryButton().focus());

      rerender(panel("checking"));

      expect(retryButton()).toHaveFocus();
    });

    it("ignores presses while the retry runs", () => {
      const onRetry = vi.fn();
      const { rerender } = render(panel("failed", onRetry));
      rerender(panel("checking", onRetry));

      fireEvent.click(retryButton());

      expect(onRetry).not.toHaveBeenCalled();
    });

    it("is described by the check in progress while the retry runs", () => {
      const { rerender } = render(panel("failed"));

      rerender(panel("checking"));

      expect(retryButton()).toHaveAccessibleDescription("Checking for roster updates…");
    });

    it("is offered again when the retry fails too", () => {
      const { rerender } = render(panel("failed"));
      rerender(panel("checking"));

      rerender(panel("failed"));

      expect(retryButton()).not.toHaveAttribute("aria-disabled", "true");
      expect(retryButton()).toHaveAccessibleDescription("Couldn't check for roster updates");
    });

    it("goes away when the retry succeeds and Retry does not hold focus", () => {
      const { rerender } = render(panel("failed"));
      rerender(panel("checking"));

      rerender(panel("upToDate"));

      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("stays while it holds focus after the retry succeeds, then goes once focus leaves", () => {
      const { rerender } = render(panel("failed"));
      act(() => retryButton().focus());
      rerender(panel("checking"));

      rerender(panel("upToDate"));

      expect(retryButton()).toHaveFocus();
      expect(retryButton()).toHaveAttribute("aria-disabled", "true");

      act(() => retryButton().blur());

      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });
  });

  it("does not make the status line focusable or give it a custom focus ring", () => {
    renderPanel("failed");

    expect(statusLine()).not.toHaveAttribute("tabindex");
    expect(statusLine().className).not.toMatch(/outline-none|focus-visible:ring/);
  });

  it.each(["idle", "checking", "updated", "upToDate"] as const)("offers no Retry when the check is %s", (status) => {
    renderPanel(status);

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("underlines Retry at rest, so the link does not rely on colour alone", () => {
    renderPanel("failed");

    const classes = screen.getByRole("button", { name: "Retry" }).className.split(/\s+/);
    expect(classes).toContain("underline");
  });

  it("gives Retry the touch target size in both directions", () => {
    renderPanel("failed");

    const classes = screen.getByRole("button", { name: "Retry" }).className.split(/\s+/);
    expect(classes).toContain("min-h-[var(--hit)]");
    expect(classes).toContain("min-w-[var(--hit)]");
  });

  describe("Retry's hit area", () => {
    // jsdom has no layout, so these pin the class and structure contract that
    // keeps the whole --hit area Retry's own without growing the footer.
    const retryButton = () => screen.getByRole("button", { name: "Retry" });
    const textColumn = () => screen.getByText(/Roster data: Leaguepedia contributors,/).parentElement as HTMLElement;

    it("sits beside the text, not stacked above the licence row", () => {
      renderPanel("failed");

      expect(textColumn()).not.toContainElement(retryButton());
      expect(retryButton().parentElement).toBe(screen.getByTestId("roster-overlay-panel"));
    });

    it("has no negative margin, so nothing else lies inside it", () => {
      renderPanel("failed");

      expect(retryButton().className.split(/\s+/).filter((name) => name.startsWith("-m"))).toEqual([]);
    });

    it("never grows the footer: the text column already reserves the hit height", () => {
      renderPanel("idle");

      expect(textColumn().className.split(/\s+/)).toContain("min-h-[var(--hit)]");
    });
  });

  it("keeps Retry outside the live region", () => {
    renderPanel("failed");

    expect(statusLine()).not.toContainElement(screen.getByRole("button", { name: "Retry" }));
  });

  describe("announcements", () => {
    it("keeps the visible line out of the live region", () => {
      renderPanel("checking");

      expect(statusLine()).not.toHaveAttribute("aria-live");
      expect(statusLine()).not.toHaveAttribute("role");
    });

    it("has a visually hidden status region from the first render", () => {
      renderPanel("idle", null);

      expect(announcer()).toHaveClass("sr-only");
      expect(announcer()).toBeEmptyDOMElement();
    });

    it.each(["idle", "upToDate", "updated", "failed"] as const)(
      "announces nothing on arrival when the check is %s",
      (status) => {
        renderPanel(status);

        expect(announcer()).toBeEmptyDOMElement();
      },
    );

    it("does not announce that a check started", () => {
      renderSteps("upToDate", [["checking"]]);

      expect(announcer()).toBeEmptyDOMElement();
    });

    it("announces that the rosters are up to date, with their date", () => {
      renderSteps("checking", [["upToDate"]]);

      expect(announcer()).toHaveTextContent(/^Rosters are up to date \(June 22, 2026\)$/);
    });

    it("announces an update with the new date", () => {
      renderSteps("checking", [
        ["updated", makeInfo({ as_of: "2026-11-01", origin: "downloaded", updated: true })],
      ]);

      expect(announcer()).toHaveTextContent(/^Rosters updated to November 1, 2026$/);
    });

    it("announces a failed check", () => {
      renderSteps("failed", [["checking"], ["failed"]]);

      expect(announcer()).toHaveTextContent(/^Couldn't check for roster updates$/);
    });

    it("clears the last outcome while the next check runs, so a repeated failure is announced again", () => {
      renderSteps("checking", [["failed"], ["checking"]]);

      expect(announcer()).toBeEmptyDOMElement();
    });

    it("keeps one region across changes", () => {
      const { rerender } = render(<RosterOverlayPanel info={makeInfo()} status="checking" onRetry={() => {}} />);
      const region = announcer();

      rerender(<RosterOverlayPanel info={makeInfo()} status="failed" onRetry={() => {}} />);

      expect(announcer()).toBe(region);
    });

    it("does not announce a date that arrives late", () => {
      renderSteps("idle", [["idle", makeInfo()]], null);

      expect(announcer()).toBeEmptyDOMElement();
    });

    it("does not re-announce when the date changes after the outcome", () => {
      renderSteps("checking", [["upToDate"], ["upToDate", makeInfo({ as_of: "2026-12-01" })]]);

      expect(announcer()).toHaveTextContent(/^Rosters are up to date \(June 22, 2026\)$/);
    });

    it("still announces the outcome under StrictMode", () => {
      const { rerender } = render(
        <StrictMode>
          <RosterOverlayPanel info={makeInfo()} status="checking" onRetry={() => {}} />
        </StrictMode>,
      );

      rerender(
        <StrictMode>
          <RosterOverlayPanel info={makeInfo()} status="upToDate" onRetry={() => {}} />
        </StrictMode>,
      );

      expect(announcer()).toHaveTextContent(/^Rosters are up to date \(June 22, 2026\)$/);
    });
  });

  it("says it is checking even before the date is known", () => {
    renderPanel("checking", null);

    expect(statusLine()).toHaveTextContent(/^Checking for roster updates…$/);
  });

  it("shows the licence attribution with its link", () => {
    renderPanel("upToDate");

    expect(screen.getByText(/Roster data: Leaguepedia contributors,/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "CC BY-SA 3.0" });
    expect(link).toHaveAttribute("href", "https://www.fandom.com/licensing");
  });

  it("draws the licence attribution in the dim token at full opacity", () => {
    renderPanel("upToDate");

    const classes = screen.getByText(/Roster data: Leaguepedia contributors,/).className.split(/\s+/);
    expect(classes).toContain("text-dim");
    expect(classes.filter((name) => name.startsWith("text-") && name.includes("/"))).toEqual([]);
  });

  it("does not link a licence URL that the overlay supplies", () => {
    renderPanel(
      "upToDate",
      makeInfo({
        source: { ...makeInfo().source, license: "Proprietary", license_url: "https://evil.example/pwn" },
      }),
    );

    expect(screen.getByText(/Proprietary/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links the known licence to a hard-coded URL, ignoring the overlay's", () => {
    renderPanel(
      "upToDate",
      makeInfo({ source: { ...makeInfo().source, license_url: "https://evil.example/pwn" } }),
    );

    expect(screen.getByRole("link", { name: "CC BY-SA 3.0" })).toHaveAttribute(
      "href",
      "https://www.fandom.com/licensing",
    );
  });

  it("never falls back to window.open when the opener plugin fails", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    renderPanel("upToDate");

    fireEvent.click(screen.getByRole("link", { name: "CC BY-SA 3.0" }));
    await new Promise((r) => setTimeout(r, 20));

    expect(open).not.toHaveBeenCalled();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    open.mockRestore();
  });

  it("renders hosted actions", () => {
    render(
      <RosterOverlayPanel
        info={makeInfo()}
        status="failed"
        onRetry={() => {}}
        actions={<button type="button">Report a bug</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Report a bug" })).toBeInTheDocument();
  });

  it("keeps hosted actions reachable while the date is unknown", () => {
    render(
      <RosterOverlayPanel
        info={null}
        status="idle"
        onRetry={() => {}}
        actions={<button type="button">Report a bug</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Report a bug" })).toBeInTheDocument();
  });
});
