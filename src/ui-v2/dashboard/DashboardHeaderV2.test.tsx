import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardHeaderV2 } from "@/ui-v2/dashboard/DashboardHeaderV2";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string; count?: number; group?: string }) =>
      (o?.defaultValue ?? _k).replace("{{count}}", String(o?.count ?? "")).replace("{{group}}", o?.group ?? ""),
  }),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function setup(extra: Partial<React.ComponentProps<typeof DashboardHeaderV2>> = {}) {
  const fns = {
    onBack: vi.fn(),
    onSave: vi.fn(),
    onContinue: vi.fn(),
    onSkipToMatchDay: vi.fn(),
    onSkipToNextDay: vi.fn(),
    onNavigate: vi.fn(),
    onNavClick: vi.fn(),
    onShowCalls: vi.fn(),
  };
  render(
    <DashboardHeaderV2
      activeTabLabel="Squad"
      currentDate="12 Jan"
      hasProfileHistory={false}
      isAdvancing={false}
      isSaving={false}
      saveFlash={false}
      hasMatchToday={false}
      dayPhase="Morning"
      alerts={[]}
      teamName="Night Owls"
      activeTab="Squad"
      badges={{ unread: 0, offers: 0, players: 0, teams: 0, staff: 0 }}
      isUnemployed={false}
      callCount={0}
      {...fns}
      {...extra}
    />,
  );
  return fns;
}

describe("DashboardHeaderV2", () => {
  it("renders the team caption over the page title h1", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Squad");
    expect(screen.getByText("Night Owls")).toBeInTheDocument();
  });

  it("hides the to-resolve chip at zero and shows it with the count otherwise", () => {
    setup();
    expect(screen.queryByRole("button", { name: /to resolve/ })).toBeNull();
  });

  it("opens the calls when the chip is pressed", () => {
    const { onShowCalls } = setup({ callCount: 3 });
    fireEvent.click(screen.getByRole("button", { name: "3 to resolve" }));
    expect(onShowCalls).toHaveBeenCalledTimes(1);
  });

  it("names the icon-only Save button and announces a saved flash politely", () => {
    const { onSave } = setup({ saveFlash: true });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("keeps the status region empty when not saved", () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("labels the primary action Continue, or Match on match day", () => {
    setup();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("switches the primary action to the match label on match day", () => {
    const { onContinue } = setup({ hasMatchToday: true });
    fireEvent.click(screen.getByRole("button", { name: "Match" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("offers skip to match day, skip to next day and continue in the menu", async () => {
    const { onSkipToMatchDay, onSkipToNextDay, onContinue } = setup();
    const chevron = screen.getByRole("button", { name: "More ways to advance" });
    chevron.focus();
    fireEvent.keyDown(chevron, { key: "ArrowDown" });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Skip to match day", "Skip to next day", "Continue"]);
    fireEvent.click(items[0]);
    expect(onSkipToMatchDay).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onSkipToNextDay).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("shows the Back button only with profile history", () => {
    const { onBack } = setup({ hasProfileHistory: true });
    fireEvent.click(screen.getByRole("button", { name: "common.back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the section strip for grouped tabs and navigates through it", () => {
    const { onNavClick } = setup({ activeTab: "Market" });
    fireEvent.click(screen.getByRole("button", { name: /Transfers/ }));
    expect(onNavClick).toHaveBeenCalledWith("Transfers");
  });

  it("renders no strip for direct stops", () => {
    setup({ activeTab: "Home" });
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renders no strip in compact mode", () => {
    setup({ activeTab: "Market", compact: true });
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("hides the Club strip while unemployed", () => {
    setup({ activeTab: "Squad", isUnemployed: true });
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
