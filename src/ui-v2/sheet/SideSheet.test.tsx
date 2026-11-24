import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dismissOverlayWithBack,
  paletteHoldsEntry,
  resetNativeBackOverlaysForTests,
  setNativeBackRegistered,
} from "@/ui-v2/palette/paletteHistory";

import { SideSheet, SideSheetClose, useSideSheet } from "./SideSheet";

const onClose = vi.fn();
const onActivated = vi.fn();
const returnFocus = vi.fn<() => HTMLElement | null>();

type Extra = Partial<Omit<ComponentProps<typeof SideSheet>, "open" | "children">>;

function Activator() {
  const { activate } = useSideSheet();
  return (
    <button type="button" onClick={() => activate({ row: 7 })}>
      Row
    </button>
  );
}

/** A controlled sheet: `onClose` is recorded, then the sheet closes like a caller's store would. */
function Harness({ initiallyOpen = true, children, ...extra }: Extra & { initiallyOpen?: boolean; children?: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Opener
      </button>
      <SideSheet
        open={open}
        onClose={(reason) => {
          onClose(reason);
          setOpen(false);
        }}
        title="Club"
        closeLabel="Close"
        platform="android"
        onActivated={onActivated}
        returnFocus={returnFocus}
        {...extra}
      >
        {children ?? <Activator />}
      </SideSheet>
    </>
  );
}

const popup = () => document.querySelector('[data-slot="side-sheet"]') as HTMLElement | null;
const later = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe("SideSheet", () => {
  beforeEach(async () => {
    // The history entry is module state: let the previous test's entry come off first.
    await waitFor(() => expect(paletteHoldsEntry()).toBe(false));
    onClose.mockReset();
    onActivated.mockReset();
    returnFocus.mockReset();
    returnFocus.mockImplementation(() => document.getElementById("opener"));
    resetNativeBackOverlaysForTests();
    window.history.replaceState({ idx: 0, key: "sheet" }, "");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetNativeBackOverlaysForTests();
  });

  it("is a modal dialog named by its title, with a 48 px Close and its children", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Club" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("data-platform")).toBe("android");
    expect(screen.getByRole("heading", { name: "Club" })).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("size-[var(--hit)]");
    expect(screen.getByRole("button", { name: "Row" })).toBeTruthy();
  });

  it("opens from the start side by default and from the end side when asked", () => {
    const { unmount } = render(<Harness />);
    expect(popup()?.getAttribute("data-side")).toBe("start");
    expect(popup()?.className).toContain("start-0");
    expect(popup()?.className).toContain("ps-[var(--safe-left)]");
    unmount();
    render(<Harness side="end" />);
    expect(popup()?.getAttribute("data-side")).toBe("end");
    expect(popup()?.className).toContain("end-0");
    expect(popup()?.className).toContain("pe-[var(--safe-right)]");
    expect(popup()?.className).not.toContain("ps-[var(--safe-left)]");
  });

  it("starts after the rail with alignToRail, without adding the left inset twice", () => {
    render(<Harness alignToRail />);
    expect(popup()?.getAttribute("data-align-to-rail")).toBe("true");
    expect(popup()?.className).toContain("start-[calc(var(--safe-left)+var(--rail-w-phone,0px))]");
    expect(popup()?.className).not.toContain("ps-[var(--safe-left)]");
  });

  it("is --sheet-w wide, capped at the window, and as tall as the dynamic viewport", () => {
    render(<Harness />);
    expect(popup()?.className).toContain("w-[var(--sheet-w)]");
    expect(popup()?.className).toContain("max-w-full");
    expect(popup()?.className).toContain("h-[var(--sheet-vvh,100dvh)]");
  });

  it("puts the focus on its title when it opens", async () => {
    render(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Club" })));
  });

  it("puts the focus on the element initialFocus names", async () => {
    function Focused() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Harness initialFocus={ref}>
          <button type="button" ref={ref}>
            First
          </button>
        </Harness>
      );
    }
    render(<Focused />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" })));
  });

  it("closes with reason dismiss on Escape and returns the focus through returnFocus", async () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("dismiss"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("opener")));
    expect(returnFocus).toHaveBeenCalled();
  });

  it("closes with reason dismiss on Close", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("dismiss"));
    expect(returnFocus).toHaveBeenCalled();
  });

  it("closes with reason dismiss on a tap on the backdrop", async () => {
    render(<Harness />);
    const backdrop = document.querySelector('[data-slot="side-sheet-backdrop"]') as HTMLElement;
    expect(backdrop.className).toContain("bg-background/70");
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("dismiss"));
    expect(returnFocus).toHaveBeenCalled();
  });

  it("falls back to #main-content when returnFocus has no element", async () => {
    returnFocus.mockReturnValue(null);
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(main));
    main.remove();
  });

  it("activate closes with reason activate, then runs onActivated once with the payload and returns the focus nowhere", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Row" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("activate");
    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
    expect(onActivated).toHaveBeenCalledWith({ row: 7 });
    // After the close completed: the popup is gone by then.
    expect(popup()).toBeNull();
    await later(30);
    expect(onActivated).toHaveBeenCalledTimes(1);
    expect(returnFocus).not.toHaveBeenCalled();
  });

  it("exposes activate to the owner through activateRef", async () => {
    const activateRef = { current: null as ((payload: unknown) => void) | null };
    render(<Harness activateRef={activateRef} />);
    expect(activateRef.current).toBeTypeOf("function");
    act(() => activateRef.current?.("outside"));
    expect(onClose).toHaveBeenCalledWith("activate");
    await waitFor(() => expect(onActivated).toHaveBeenCalledWith("outside"));
  });

  it("runs onActivated only after the sheet's history entry is off, so a route it pushes stays", async () => {
    const before = window.history.state;
    let stateAtRun: unknown = "not run";
    onActivated.mockImplementation(() => {
      stateAtRun = window.history.state;
      window.history.pushState({ idx: 1, key: "route" }, "");
    });
    render(<Harness />);
    expect(window.history.state).toEqual({ ...before, olmPalette: true });
    fireEvent.click(screen.getByRole("button", { name: "Row" }));
    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
    expect(stateAtRun).toEqual(before);
    await later(30);
    expect(window.history.state).toEqual({ idx: 1, key: "route" });
  });

  it("drops a pending activation when the sheet reopens before the close completes", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Row" }));
    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
    onActivated.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Opener" }));
    await screen.findByRole("dialog");
    await later(30);
    expect(onActivated).not.toHaveBeenCalled();
  });

  it("sets --sheet-vvh from the visual viewport only with fitVisualViewport", async () => {
    const listeners = new Set<() => void>();
    const viewport = {
      height: 210,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    vi.stubGlobal("visualViewport", viewport);
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    const { unmount } = render(<Harness />);
    expect(popup()?.style.getPropertyValue("--sheet-vvh")).toBe("");
    unmount();
    render(<Harness fitVisualViewport />);
    await waitFor(() => expect(popup()?.style.getPropertyValue("--sheet-vvh")).toBe("210px"));
    viewport.height = 120;
    act(() => listeners.forEach((fn) => fn()));
    expect(popup()?.style.getPropertyValue("--sheet-vvh")).toBe("120px");
    vi.unstubAllGlobals();
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
  });

  it("closes on Back through the native dismisser with reason dismiss", async () => {
    setNativeBackRegistered(true);
    render(<Harness />);
    act(() => {
      dismissOverlayWithBack();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("dismiss"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Back through its history entry when the native listener is not registered", async () => {
    render(<Harness />);
    expect(window.history.state).toMatchObject({ olmPalette: true });
    act(() => window.history.back());
    await waitFor(() => expect(onClose).toHaveBeenCalledWith("dismiss"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("makes no history call on desktop", async () => {
    const spies = (["pushState", "back"] as const).map((m) => vi.spyOn(window.history, m));
    render(<Harness platform="desktop" />);
    expect(setNativeBackRegistered).toBeTypeOf("function");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(popup()?.getAttribute("data-platform")).toBe("desktop");
  });

  it("with two sheets open, Back closes the later one first", async () => {
    setNativeBackRegistered(true);
    const closeA = vi.fn();
    const closeB = vi.fn();
    render(
      <>
        <SideSheet open onClose={closeA} title="A" closeLabel="Close" platform="android" data-slot="sheet-a">
          a
        </SideSheet>
        <SideSheet open onClose={closeB} title="B" closeLabel="Close" platform="android" data-slot="sheet-b">
          b
        </SideSheet>
      </>,
    );
    act(() => {
      dismissOverlayWithBack();
    });
    expect(closeB).toHaveBeenCalledWith("dismiss");
    expect(closeA).not.toHaveBeenCalled();
  });

  it("hands the Escape key to the owner's onKeyDown when it prevents Base UI's own close", async () => {
    const own = vi.fn((e: React.KeyboardEvent & { preventBaseUIHandler?: () => void }) => {
      if (e.key === "Escape") {
        e.preventBaseUIHandler?.();
        e.stopPropagation();
      }
    });
    render(<Harness onKeyDown={own} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(own).toHaveBeenCalled();
    await later(30);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders headerExtra between the title and Close", () => {
    render(<Harness headerExtra={<span data-testid="extra">3</span>} />);
    const header = screen.getByRole("heading", { name: "Club" }).parentElement as HTMLElement;
    const kids = Array.from(header.children);
    const names = kids.map((el) => el.getAttribute("data-testid") ?? el.tagName);
    expect(names).toEqual(["H2", "extra", "BUTTON"]);
  });

  it("leaves Close to the owner with closePlacement body, which renders SideSheetClose where it likes", () => {
    render(
      <Harness closePlacement="body">
        <SideSheetClose />
      </Harness>,
    );
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Club" }).parentElement?.getAttribute("role")).toBe("dialog");
  });
});
