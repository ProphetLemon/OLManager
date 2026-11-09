import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return {
    initReactI18next: { type: "3rdParty", init: vi.fn() },
    useTranslation: () => ({ i18n: { language: "en" }, t: translateFromEnglish }),
  };
});

import { SUPERSEDED } from "@/lib/customTeam/founders";
import FounderEditDialog from "./FounderEditDialog";
import { ALLOWED_NATIONALITIES, squadFor } from "./foundersTestKit";

const founder = squadFor(7).players[2];

function setup(onApply = vi.fn().mockResolvedValue(null)) {
  const onClose = vi.fn();
  render(
    <FounderEditDialog
      founder={founder}
      generated={founder}
      overrides={{}}
      allowedNationalities={ALLOWED_NATIONALITIES}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return { onApply, onClose, dialog: screen.getByRole("dialog") };
}

describe("FounderEditDialog", () => {
  it("states the nick, full name and birth date constraints before any submit", () => {
    const { dialog } = setup();

    expect(within(dialog).getByLabelText("Nick")).toHaveAccessibleDescription(
      "2 to 16 characters: letters, digits, _ . and -",
    );
    expect(within(dialog).getByLabelText("Full name")).toHaveAccessibleDescription(
      "2 to 40 characters: letters, spaces, apostrophes and hyphens",
    );
    // Dates are localized, not raw ISO strings.
    expect(within(dialog).getByLabelText("Birth date")).toHaveAccessibleDescription(
      "Born between Jan 1, 2004 and Dec 31, 2004 to stay 20 years old.",
    );
  });

  it("keeps the constraint hint together with the field error in the description", async () => {
    const onApply = vi.fn().mockResolvedValue({ kind: "invalid_field", role: "MID", field: "nick", reason: "taken" });
    const { dialog } = setup(onApply);
    fireEvent.change(within(dialog).getByLabelText("Nick"), { target: { value: "Ray" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await within(dialog).findByRole("alert");
    expect(within(dialog).getByLabelText("Nick")).toHaveAccessibleDescription(
      "2 to 16 characters: letters, digits, _ . and - Another player already uses this name.",
    );
  });

  it("stays open and says so when a newer request replaced the edit", async () => {
    const { dialog, onClose } = setup(vi.fn().mockResolvedValue(SUPERSEDED));
    fireEvent.change(within(dialog).getByLabelText("Nick"), { target: { value: "Ray" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Could not check this edit. Try again.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop click when nothing was typed, but not over unsaved edits", async () => {
    const clean = setup();
    const backdrop = () => document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    const clickBackdrop = () => {
      const target = backdrop();
      if (!target) throw new Error("no backdrop");
      fireEvent.pointerDown(target);
      fireEvent.mouseDown(target);
      fireEvent.pointerUp(target);
      fireEvent.mouseUp(target);
      fireEvent.click(target);
    };

    clickBackdrop();
    await waitFor(() => expect(clean.onClose).toHaveBeenCalled());
  });

  it("does not discard typed edits on a backdrop click", async () => {
    const { dialog, onClose } = setup();
    fireEvent.change(within(dialog).getByLabelText("Nick"), { target: { value: "Ray" } });
    const target = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    if (!target) throw new Error("no backdrop");
    fireEvent.pointerDown(target);
    fireEvent.mouseDown(target);
    fireEvent.pointerUp(target);
    fireEvent.mouseUp(target);
    fireEvent.click(target);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
