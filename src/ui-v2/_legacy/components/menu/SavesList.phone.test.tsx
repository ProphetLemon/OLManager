import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissOverlayWithBack, resetNativeBackOverlaysForTests } from "@/ui-v2/palette/paletteHistory";
import type { SaveFile } from "@/api/types";
import SavesList from "./SavesList";

// The whole file runs as a phone: the hook reads the user agent while rendering.
vi.hoisted(() => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  });
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

/*
 * What these tests cannot prove: jsdom has no layout, so they read class names and the DOM
 * only. That a class gives 48 or 56 px, that the list scrolls and that the name truncates before
 * the date is measured on the emulator sweep (screen 02), not here.
 */

const save = {
  id: "a",
  name: "Career",
  manager_name: "John Smith",
  db_filename: "",
  checksum: "",
  created_at: "2026-01-01T00:00:00Z",
  last_played_at: "2026-01-02T00:00:00Z",
};

function renderList(overrides: Partial<React.ComponentProps<typeof SavesList>> = {}) {
  const props = {
    saves: [save],
    isLoading: false,
    confirmDeleteId: null,
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    onClose: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onConfirmReplace: vi.fn(),
    onCancelReplace: vi.fn(),
    transferBusy: false,
    transferNotice: null,
    pendingReplace: null,
    ...overrides,
  };
  const view = render(<SavesList {...props} />);
  return { props, ...view };
}

const TARGET_H = "min-h-[var(--target-min)]";
const TARGET_W = "min-w-[var(--target-min)]";

describe("SavesList on the phone", () => {
  it("gives a row at least 56 px and its Load block the same", () => {
    const { container } = renderList();
    const row = container.querySelector<HTMLElement>("[data-save-row]")!;
    const load = container.querySelector<HTMLElement>("[data-save-load]")!;

    expect(row).toHaveClass("min-h-[56px]");
    expect(load).toHaveClass("min-h-[56px]");
  });

  it("makes Export and Delete icon buttons of at least 48 x 48", () => {
    renderList();
    for (const name of ["menu.transfer.export", "menu.deleteSave"]) {
      expect(screen.getByRole("button", { name })).toHaveClass(TARGET_H, TARGET_W);
    }
  });

  it("makes the header's Import and Close at least 48 high, and Close 48 wide, with a name", () => {
    renderList();

    expect(screen.getByRole("button", { name: /menu.transfer.import/ })).toHaveClass(TARGET_H);
    expect(screen.getByRole("button", { name: "common.close" })).toHaveClass(TARGET_H, TARGET_W);
  });

  it("shows the Play affordance without hover, since touch has none", () => {
    const { container } = renderList();
    const play = container.querySelector("svg.lucide-play")!;

    expect(play).not.toBeNull();
    expect(play.getAttribute("class")).not.toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(play.getAttribute("class")).not.toMatch(/group-hover:opacity/);
  });

  it("lets the list scroll inside a fixed header instead of capping it at 60vh", () => {
    renderList();
    const list = screen.getByRole("button", { name: "menu.deleteSave" }).closest(".overflow-y-auto");

    expect(list).toHaveClass("min-h-0", "flex-1", "pr-2", "[scrollbar-gutter:stable]");
    expect(list?.className).not.toMatch(/max-h-/);
  });

  it("keeps the delete confirmation's two buttons at least 48 high", () => {
    renderList({ confirmDeleteId: "a" });

    expect(screen.getByRole("button", { name: "menu.delete" })).toHaveClass(TARGET_H);
    expect(screen.getByRole("button", { name: "menu.cancel" })).toHaveClass(TARGET_H);
  });

  it("keeps the replace dialog's two buttons at least 48 high", () => {
    renderList({ pendingReplace: { name: "Old", id: "x" } as unknown as React.ComponentProps<typeof SavesList>["pendingReplace"] });

    expect(screen.getByRole("button", { name: "menu.transfer.replace" })).toHaveClass(TARGET_H);
    expect(screen.getByRole("button", { name: "menu.cancel" })).toHaveClass(TARGET_H);
  });

  it("keeps an other-version save described and not loadable, with Export and Delete active", () => {
    const other = { ...save, id: "b", name: "Old career", status: "other_version", format_version: 3 } as unknown as SaveFile;
    const { props, container } = renderList({ saves: [other as never] });
    const load = container.querySelector<HTMLElement>("[data-save-load]")!;
    const reason = document.getElementById(load.getAttribute("aria-describedby")!);

    expect(load).toHaveAttribute("aria-disabled", "true");
    expect(reason).toHaveTextContent("menu.saveStatus.otherVersionReason");
    fireEvent.click(load);
    expect(props.onLoad).not.toHaveBeenCalled();

    const exportButton = screen.getByRole("button", { name: "menu.transfer.export" });
    const deleteButton = screen.getByRole("button", { name: "menu.deleteSave" });
    expect(exportButton).toBeEnabled();
    expect(deleteButton).toBeEnabled();
    expect(exportButton).toHaveClass(TARGET_H, TARGET_W);
  });

  it("still loads a readable save when its block is pressed", () => {
    const { props, container } = renderList();

    fireEvent.click(container.querySelector("[data-save-load]")!);

    expect(props.onLoad).toHaveBeenCalledWith("a");
  });
});

describe("SavesList on the phone, Back", () => {
  afterEach(() => resetNativeBackOverlaysForTests());

  it("closes an open delete confirmation on Back, leaving the list", () => {
    const { props } = renderList({ confirmDeleteId: "a" });

    expect(dismissOverlayWithBack()).toBe(true);

    expect(props.onConfirmDelete).toHaveBeenCalledWith(null);
  });

  it("cancels a pending replace on Back", () => {
    const pending = { name: "Old", id: "x" } as unknown as React.ComponentProps<typeof SavesList>["pendingReplace"];
    const { props } = renderList({ pendingReplace: pending });

    expect(dismissOverlayWithBack()).toBe(true);

    expect(props.onCancelReplace).toHaveBeenCalledTimes(1);
  });

  it("registers nothing while neither is open", () => {
    renderList();

    expect(dismissOverlayWithBack()).toBe(false);
  });
});
