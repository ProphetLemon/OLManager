import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import ReportBugModal from "./ReportBugModal";

vi.mock("@/services/bugReportService", () => ({ exportBugReport: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string }) =>
      typeof opts === "string" ? opts : (opts?.defaultValue ?? key),
  }),
}));

const context = {
  appVersion: "1",
  route: "/",
  activeTab: "Home",
  currentDate: "d",
  dayPhase: "Morning",
  teamName: "T",
  leagueName: "L",
  lolPatch: "p",
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <nav aria-label="Rail">
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      {open && <ReportBugModal context={context} saveJson="{}" onClose={() => setOpen(false)} />}
    </nav>
  );
}

describe("ReportBugModal dialog semantics", () => {
  it("is a labelled modal dialog rendered outside the opening nav", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Opener" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Reportar Bug / Sugerir Mejora");
    expect(screen.getByRole("navigation", { hidden: true }).contains(dialog)).toBe(false);
  });

  it("moves focus to the first field on open", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Opener" }));
    const field = await screen.findByRole("textbox");
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("closes on Escape and returns focus to the opener", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("hides the background from assistive tech while open and restores it on close", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Opener" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Opener" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Opener" })).toBeInTheDocument());
  });
});
