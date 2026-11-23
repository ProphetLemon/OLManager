import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleNativeBack, resetBackGuardForTests } from "@/lib/backGuard";
import { dismissOverlayWithBack } from "@/ui-v2/palette/paletteHistory";
import MainMenu from "./MainMenu";

// The whole file runs as a phone and as Android: MainMenu reads the user agent when it is
// imported (the exit hook) and while it renders (the phone layout).
vi.hoisted(() => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  });
});

const exitAppMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/services/appExit", () => ({ exitApp: exitAppMock }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/api/client", () => ({
  getApiClientSync: () => ({
    saves: { list: vi.fn(() => Promise.resolve([])) },
    serverCommands: { debugLog: vi.fn(() => Promise.resolve()) },
  }),
  setApiClient: () => {},
}));
vi.mock("@/ui-v2/_legacy/components/menu/MenuBackground", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

/*
 * What these tests cannot prove: jsdom has no layout, so they read class names, the DOM order and
 * focus only. That the six items fit 804 x 360 and 915 x 412 without scrolling, that every
 * target measures 48 x 48 and that no text is under 12 px is measured on the emulator sweep
 * (screen 01), not here.
 */

const ORDER = [
  "menu.newGame",
  "menu.loadGame",
  "menu.settings",
  "menu.community",
  "menu.patchNotes",
  "menu.exitGame",
];
const TARGET_H = "min-h-[var(--target-min)]";
const TARGET_W = "min-w-[var(--target-min)]";

function renderMenu() {
  return render(
    <MemoryRouter>
      <MainMenu />
    </MemoryRouter>,
  );
}

async function openPanel(label: string, heading: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  return screen.findByRole("heading", { name: heading });
}

describe("MainMenu on the phone, main state", () => {
  beforeEach(() => resetBackGuardForTests());
  afterEach(() => {
    resetBackGuardForTests();
    vi.clearAllMocks();
  });

  it("lists the six items in the menu's order", () => {
    renderMenu();

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(ORDER);
  });

  it("keeps exactly one nav, holding the five destinations", () => {
    renderMenu();
    const navs = screen.getAllByRole("navigation");

    expect(navs).toHaveLength(1);
    expect(within(navs[0]).getAllByRole("button").map((b) => b.textContent)).toEqual(ORDER.slice(0, 5));
  });

  it("gives every item a target class of at least 48 x 48", () => {
    renderMenu();

    for (const button of screen.getAllByRole("button")) {
      expect(button, button.textContent ?? "").toHaveClass(TARGET_H, TARGET_W);
    }
  });

  it("makes New Game the wide tile and the other four equal tiles of a 2 x 2 block", () => {
    renderMenu();

    expect(screen.getByRole("button", { name: "menu.newGame" })).toHaveClass("col-span-2");
    for (const name of ["menu.loadGame", "menu.settings", "menu.community", "menu.patchNotes"]) {
      expect(screen.getByRole("button", { name })).not.toHaveClass("col-span-2");
    }
  });

  it("puts Exit game and the version label in the left column, the label not absolutely placed", () => {
    renderMenu();
    const exit = screen.getByRole("button", { name: "menu.exitGame" });
    const version = screen.getByText(/app\.version/);

    for (const element of [exit, version]) {
      const column = element.closest<HTMLElement>("[data-menu-column='start']");
      expect(column, element.textContent ?? "").not.toBeNull();
      expect(column).toHaveClass("col-start-1");
    }
    expect(version.className).not.toMatch(/(^|\s)absolute(\s|$)/);
  });

  it("keeps the roving keyboard model: Down moves one item and Enter opens it", async () => {
    renderMenu();
    const first = screen.getByRole("button", { name: "menu.newGame" });
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("button", { name: "menu.loadGame" })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("button", { name: "menu.loadGame" }), { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "menu.loadGame" })).toBeInTheDocument();
  });
});

describe("MainMenu on the phone, panels", () => {
  beforeEach(() => resetBackGuardForTests());
  afterEach(() => {
    resetBackGuardForTests();
    vi.clearAllMocks();
  });

  it("puts a panel in the right area in place of the tiles, scrollable and never centred", async () => {
    renderMenu();
    const heading = await openPanel("menu.loadGame", "menu.loadGame");
    const wrapper = heading.closest<HTMLElement>(".overflow-y-auto");

    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).not.toMatch(/justify-center/);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(wrapper).toHaveClass("col-start-2");
    // The left column stays.
    expect(screen.getByRole("button", { name: "menu.exitGame" })).toBeInTheDocument();
    expect(screen.getByText(/app\.version/)).toBeInTheDocument();
  });

  it.each([
    ["menu.newGame", "createManager.title"],
    ["menu.community", "community.title"],
    ["menu.patchNotes", "menu.patchNotes"],
  ])("gives the Close button of the %s panel a name and a 48 x 48 target", async (label, heading) => {
    renderMenu();
    await openPanel(label, heading);

    expect(screen.getByRole("button", { name: "common.close" })).toHaveClass(TARGET_H, TARGET_W);
  });

  it("closes an open panel on system Back and returns focus to the tile that opened it", async () => {
    renderMenu();
    await openPanel("menu.community", "community.title");

    let handled = false;
    act(() => {
      handled = dismissOverlayWithBack();
    });

    expect(handled).toBe(true);
    expect(screen.queryByRole("heading", { name: "community.title" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "menu.community" })).toHaveFocus());
  });

  it("returns focus to the tile that opened a panel when Close is pressed", async () => {
    renderMenu();
    await openPanel("menu.patchNotes", "menu.patchNotes");

    fireEvent.click(screen.getByRole("button", { name: "common.close" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "menu.patchNotes" })).toHaveFocus());
  });

  it("registers no Back dismisser on the main state, so Back still exits the app", () => {
    renderMenu();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

    expect(dismissOverlayWithBack()).toBe(false);
    handleNativeBack({ canGoBack: true }, exitAppMock);

    expect(exitAppMock).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it("drops its dismisser once the panel is closed, so the next Back exits", async () => {
    renderMenu();
    await openPanel("menu.community", "community.title");
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "menu.community" })).toBeInTheDocument());

    expect(dismissOverlayWithBack()).toBe(false);
    handleNativeBack({ canGoBack: true }, exitAppMock);
    expect(exitAppMock).toHaveBeenCalledTimes(1);
  });
});
