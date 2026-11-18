import { fireEvent, render, screen } from "@testing-library/react";
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

  it("moves focus to the status line when Retry is pressed, since Retry then goes away", () => {
    renderPanel("failed");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(statusLine()).toHaveFocus();
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

  it("gives Retry the touch target size", () => {
    renderPanel("failed");

    expect(screen.getByRole("button", { name: "Retry" }).className).toContain("min-h-[var(--hit)]");
  });

  it("keeps Retry outside the live region", () => {
    renderPanel("failed");

    expect(statusLine()).not.toContainElement(screen.getByRole("button", { name: "Retry" }));
  });

  it("is one polite live region from the first render, kept across changes, so only changes are announced", () => {
    const { rerender } = render(<RosterOverlayPanel info={null} status="idle" onRetry={() => {}} />);
    const region = statusLine();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region).toBeEmptyDOMElement();

    rerender(<RosterOverlayPanel info={makeInfo()} status="checking" onRetry={() => {}} />);
    rerender(<RosterOverlayPanel info={makeInfo()} status="failed" onRetry={() => {}} />);

    expect(statusLine()).toBe(region);
    expect(region).toHaveTextContent("Couldn't check for roster updates");
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
