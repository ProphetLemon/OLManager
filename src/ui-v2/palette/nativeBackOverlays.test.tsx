import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TFunction } from "i18next";
import { Settings } from "lucide-react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMenuBackExit } from "@/hooks/useMenuBackExit";
import { handleNativeBack, resetBackGuardForTests } from "@/lib/backGuard";
import type { CallItem } from "@/lib/dashboard/needsYourCall";
import type { DashboardLocation } from "@/lib/dashboard/profileNavigation";
import { usePaletteStore } from "@/store/paletteStore";
import { translateFromEnglish } from "@/test-i18n";
import { GoPalette } from "@/ui-v2/palette/GoPalette";
import { setNativeBackRegistered } from "@/ui-v2/palette/paletteHistory";
import { buildPaletteIndex, type PaletteEntry, type PaletteIndexInput } from "@/ui-v2/palette/paletteIndex";
import { RailMore } from "@/ui-v2/shell/RailMore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translateFromEnglish, i18n: { language: "en" } }),
}));

/**
 * While the native `back-button` listener is registered, the Go palette and the More menu
 * take no history entry on Android: Back closes them through a dismisser they register while
 * open, so nothing on the dashboard touches the history for Back.
 */
const t = translateFromEnglish as unknown as TFunction;

const scrims: CallItem = {
  id: "blocker:scrims",
  kind: "blocker",
  severity: "hard",
  tagKey: "onAir.tags.blocker",
  tagTone: "negative",
  headline: "No scrims planned for Thursday",
  actionLabelKey: "onAir.calls.actions.openScrims",
  target: { tab: "Scrims" },
};
const renewal: CallItem = {
  id: "contract:p1",
  kind: "contract",
  severity: "soft",
  tagKey: "onAir.tags.contract",
  tagTone: "warning",
  headline: "Upset",
  actionLabelKey: "onAir.calls.actions.renew",
  target: { tab: "Squad", context: { playerId: "p1" } },
};
const at = (tab: string, over: Partial<DashboardLocation> = {}): DashboardLocation => ({
  tab,
  playerId: null,
  teamId: null,
  staffId: null,
  championKey: null,
  ...over,
});

const entries = buildPaletteIndex({
  callState: { decisionItems: [scrims, renewal] },
  recent: [at("Squad", { playerId: "p1" }), at("Inbox")],
  current: at("Home"),
  unemployed: false,
  scheduleCalendar: true,
  selectedCompetitionId: null,
  game: {
    manager: { team_id: "team-1" },
    user_competition_id: "lec",
    leagues: [{ id: "league-lec", competition_id: "lec" }],
    players: [{ id: "p1", match_name: "Upset", team_id: "team-1", position: "ADC", lol_ovr: 86 }],
    teams: [{ id: "team-1", name: "Fnatic" }],
    staff: [],
  } as unknown as PaletteIndexInput["game"],
  t,
});


const onActivate = vi.fn<(entry: PaletteEntry) => void>();
const onSelect = vi.fn();
const exitApp = vi.fn(() => Promise.resolve());

function PaletteHarness() {
  return (
    <>
      <button id="util:go" type="button">
        Go
      </button>
      <main id="main-content" tabIndex={-1}>
        content
      </main>
      <GoPalette entries={entries} callCount={2} platform="android" onActivate={onActivate} />
    </>
  );
}

function MoreHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RailMore
        label="More"
        android
        open={open}
        onOpenChange={setOpen}
        items={[{ id: "settings", label: "Settings", icon: Settings, onSelect }]}
      />
      <output data-testid="state">{open ? "open" : "closed"}</output>
    </>
  );
}

function Menu({ exit }: { exit: () => Promise<void> }) {
  useMenuBackExit(true, exit);
  return <p>menu</p>;
}

const press = () => handleNativeBack({ canGoBack: true }, exitApp);

async function openPalette() {
  render(<PaletteHarness />);
  act(() => usePaletteStore.getState().openPalette("util:go"));
  return screen.findByRole("dialog");
}

describe("overlays without a history entry (native back-button registered)", () => {
  let back: ReturnType<typeof vi.spyOn>;
  let pushState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    usePaletteStore.getState().reset();
    Element.prototype.scrollIntoView = vi.fn();
    onActivate.mockReset();
    onSelect.mockReset();
    exitApp.mockClear();
    back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    pushState = vi.spyOn(window.history, "pushState");
    setNativeBackRegistered(true);
  });
  afterEach(() => {
    cleanup();
    resetBackGuardForTests();
    vi.restoreAllMocks();
  });

  describe("the Go palette", () => {
    it("pushes no entry when it opens, and Back closes it without a history call", async () => {
      await openPalette();
      expect(pushState).not.toHaveBeenCalled();
      act(() => press());
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(back).not.toHaveBeenCalled();
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("takes no entry off when Escape closes it", async () => {
      await openPalette();
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(back).not.toHaveBeenCalled();
    });

    it("stops answering Back once closed", async () => {
      await openPalette();
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      press();
      expect(back).toHaveBeenCalledTimes(1); // nothing set: the press goes back
    });

    it("stops answering Back once unmounted, so a menu behind it exits", async () => {
      const exit = vi.fn(() => Promise.resolve());
      const view = render(<PaletteHarness />);
      act(() => usePaletteStore.getState().openPalette("util:go"));
      await screen.findByRole("dialog");
      view.unmount();
      render(<Menu exit={exit} />);
      press();
      expect(exit).toHaveBeenCalledTimes(1);
    });

    it("still runs a chosen row", async () => {
      await openPalette();
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
      await waitFor(() => expect(onActivate).toHaveBeenCalledTimes(1));
      expect(back).not.toHaveBeenCalled();
      expect(pushState).not.toHaveBeenCalled();
    });
  });

  describe("the More menu", () => {
    it("pushes no entry when it opens, and Back closes it without a history call", async () => {
      render(<MoreHarness />);
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      await screen.findByRole("menu");
      expect(pushState).not.toHaveBeenCalled();
      act(() => press());
      await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("closed"));
      expect(back).not.toHaveBeenCalled();
    });

    it("still runs a chosen item, with no history call", async () => {
      render(<MoreHarness />);
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
      await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
      expect(back).not.toHaveBeenCalled();
    });

    it("stops answering Back once closed", async () => {
      render(<MoreHarness />);
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      await screen.findByRole("menu");
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("closed"));
      press();
      expect(back).toHaveBeenCalledTimes(1);
    });
  });
});
