import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BlockerModal } from "@/hooks/useAdvanceTime.helpers";
import DashboardBlockerModal from "./DashboardBlockerModal";
import DashboardOverlays from "./DashboardOverlays";
import DashboardExitConfirmModal from "./DashboardExitConfirmModal";
import DashboardExitSavingModal from "./DashboardExitSavingModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string }) =>
      typeof opts === "string" ? opts : (opts?.defaultValue ?? key),
  }),
}));

function ExitHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Exit
      </button>
      {open ? <DashboardExitConfirmModal onCancel={() => setOpen(false)} onConfirm={vi.fn()} /> : null}
    </>
  );
}

describe("DashboardExitConfirmModal", () => {
  it("is a labelled modal dialog with focus inside", async () => {
    render(<ExitHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));

    const dialog = await screen.findByRole("dialog", { name: "exitConfirm.title" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("closes on Escape and returns focus to the opener", async () => {
    render(<ExitHarness />);
    const opener = screen.getByRole("button", { name: "Exit" });
    act(() => opener.focus());
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("returns focus to the opener after Cancel instead of the body", async () => {
    render(<ExitHarness />);
    const opener = screen.getByRole("button", { name: "Exit" });
    act(() => opener.focus());
    fireEvent.click(opener);

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("DashboardExitSavingModal", () => {
  it("is a labelled modal dialog that ignores Escape while saving", async () => {
    render(<DashboardExitSavingModal />);
    const dialog = await screen.findByRole("dialog", { name: "exitConfirm.savingTitle" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("DashboardBlockerModal", () => {
  const blockerModal = {
    blockers: [{ id: "b1", tab: "Squad", text: "Pick a lineup", severity: "warn" }],
  } as unknown as BlockerModal;

  it("is a labelled dialog whose close button has an accessible name", async () => {
    const onClose = vi.fn();
    render(
      <DashboardBlockerModal
        blockerModal={blockerModal}
        onClose={onClose}
        onContinueAnyway={null}
        onNavigate={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "notifications.attentionRequired" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <DashboardBlockerModal
        blockerModal={blockerModal}
        onClose={onClose}
        onContinueAnyway={null}
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("offers Continue anyway for blockers the backend does not enforce", async () => {
    render(
      <DashboardBlockerModal
        blockerModal={blockerModal}
        onClose={vi.fn()}
        onContinueAnyway={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(await screen.findByRole("button", { name: "notifications.continueAnyway" })).toBeInTheDocument();
  });

  it.each(["scrim_setup_required", "scrim_decision_required"])(
    "never offers Continue anyway for the enforced %s blocker",
    async (id) => {
      const enforced = {
        blockers: [
          { id: "b1", tab: "Squad", text: "Pick a lineup", severity: "warn" },
          { id, tab: "Scrims", text: "Scrims", severity: "warn" },
        ],
      } as unknown as BlockerModal;
      render(
        <DashboardBlockerModal
          blockerModal={enforced}
          onClose={vi.fn()}
          onContinueAnyway={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
      await screen.findByRole("dialog");
      expect(screen.queryByRole("button", { name: "notifications.continueAnyway" })).toBeNull();
    },
  );
});

describe("DashboardOverlays blocker modal", () => {
  function renderOverlays(modal: BlockerModal) {
    return render(
      <DashboardOverlays
        blockerModal={modal}
        currentModeMeta={{} as never}
        handleConfirmMatch={vi.fn()}
        handleExitToMenu={vi.fn()}
        handleNavigate={vi.fn()}
        handleCloseQuit={vi.fn()}
        isExitingToMenu={false}
        matchMode="live"
        setBlockerModal={vi.fn()}
        setShowCloseConfirm={vi.fn()}
        setShowExitConfirm={vi.fn()}
        setShowMatchConfirm={vi.fn()}
        showCloseConfirm={false}
        showExitConfirm={false}
        showMatchConfirm={false}
        teams={[]}
        todayMatchFixture={null}
      />,
    );
  }

  it("drops the pending action when an enforced scrim blocker is listed", async () => {
    renderOverlays({
      blockers: [{ id: "scrim_decision_required", tab: "Scrims", text: "Decide", severity: "warn" }],
      pendingAction: vi.fn(),
    });
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "notifications.continueAnyway" })).toBeNull();
  });

  it("passes the pending action through for a soft blocker", async () => {
    renderOverlays({
      blockers: [{ id: "incomplete_lineup", tab: "Squad", text: "Lineup", severity: "warn" }],
      pendingAction: vi.fn(),
    });
    expect(await screen.findByRole("button", { name: "notifications.continueAnyway" })).toBeInTheDocument();
  });
});
