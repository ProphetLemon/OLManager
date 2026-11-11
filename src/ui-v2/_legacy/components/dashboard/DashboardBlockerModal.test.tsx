import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { BlockerModal } from "@/hooks/useAdvanceTime.helpers";
import DashboardBlockerModal from "./DashboardBlockerModal";

const modal = (tab: string, id = "academy_missing_roles"): BlockerModal => ({
  blockers: [{ id, severity: "warn", text: "Academy incomplete", tab }],
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("DashboardBlockerModal destination", () => {
  it("names the destination like the navigation, not the raw tab id", () => {
    render(
      <DashboardBlockerModal blockerModal={modal("YouthAcademy")} onClose={vi.fn()} onContinueAnyway={null} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText(/Go to Academy/)).toBeInTheDocument();
    expect(screen.queryByText(/YouthAcademy/i)).toBeNull();
  });

  it("translates the destination name", async () => {
    await i18n.changeLanguage("es");
    render(
      <DashboardBlockerModal blockerModal={modal("Squad", "incomplete_lineup")} onClose={vi.fn()} onContinueAnyway={null} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText(/Ir a Plantilla/)).toBeInTheDocument();
    expect(screen.queryByText(/Squad/)).toBeNull();
  });

  it("navigates to the tab id the navigation uses for the academy", () => {
    const onNavigate = vi.fn();
    render(
      <DashboardBlockerModal blockerModal={modal("YouthAcademy")} onClose={vi.fn()} onContinueAnyway={null} onNavigate={onNavigate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Academy incomplete/ }));
    expect(onNavigate).toHaveBeenCalledWith("Youth");
  });

  it("falls back to the raw tab for a tab the navigation does not know", () => {
    render(
      <DashboardBlockerModal blockerModal={modal("Mystery", "zzz")} onClose={vi.fn()} onContinueAnyway={null} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText(/Go to Mystery/)).toBeInTheDocument();
  });
});
