import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BlockerModal } from "@/hooks/useAdvanceTime.helpers";
import DashboardBlockerModal from "./DashboardBlockerModal";
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
});
