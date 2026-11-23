import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaveFile } from "@/api/types";
import SavesList from "./SavesList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Options are echoed so a test can see the values a message is given.
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en" },
  }),
}));

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
  render(<SavesList {...props} />);
  return props;
}

describe("SavesList transfer controls", () => {
  it("keeps the row buttons clear of the scrollbar of the scrolling list", () => {
    renderList();
    const scroller = screen.getByRole("button", { name: "menu.deleteSave" }).closest(".overflow-y-auto");

    expect(scroller).toHaveClass("pr-2", "[scrollbar-gutter:stable]");
  });

  it("exports the save whose button was pressed without loading it", () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: "menu.transfer.export" }));

    expect(props.onExport).toHaveBeenCalledWith("a");
    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("shows the export and delete buttons without hover, since touch has no hover", () => {
    renderList();
    const buttons = [screen.getByRole("button", { name: "menu.transfer.export" }), screen.getByRole("button", { name: "menu.deleteSave" })];
    for (const button of buttons) {
      expect(button.className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
      expect(button.className).not.toMatch(/group-hover:opacity/);
      expect(button).toBeVisible();
    }
  });

  it("offers import even when the list is empty", () => {
    const props = renderList({ saves: [] });

    fireEvent.click(screen.getByRole("button", { name: /menu\.transfer\.import/ }));

    expect(props.onImport).toHaveBeenCalledTimes(1);
  });

  it("disables import and export while a transfer is running", () => {
    renderList({ transferBusy: true });

    expect(screen.getByRole("button", { name: /menu\.transfer\.import/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "menu.transfer.export" })).toBeDisabled();
  });

  it("asks before replacing and routes both answers", () => {
    const props = renderList({
      pendingReplace: { name: "Career", manager_name: "John Smith", replaces: save as unknown as SaveFile },
    });

    expect(screen.getByRole("alertdialog")).toHaveTextContent("menu.transfer.replacePrompt");
    fireEvent.click(screen.getByRole("button", { name: "menu.transfer.replace" }));
    fireEvent.click(screen.getByRole("button", { name: "menu.cancel" }));

    expect(props.onConfirmReplace).toHaveBeenCalledTimes(1);
    expect(props.onCancelReplace).toHaveBeenCalledTimes(1);
  });

  it("announces an error notice as an alert", () => {
    renderList({ transferNotice: { tone: "error", text: "bad file" } });

    expect(screen.getByRole("alert")).toHaveTextContent("bad file");
  });
});

describe("SavesList saves this version cannot read", () => {
  const otherVersion = { ...save, id: "v4", name: "Newer career", status: "other_version" as const, format_version: 4 };
  const unreadable = { ...save, id: "bad", name: "Broken career", status: "unreadable" as const, format_version: null };

  function loadButton(name: RegExp) {
    return screen.getByRole("button", { name });
  }

  it("tags a save from another version and a save that cannot be read", () => {
    renderList({ saves: [otherVersion, unreadable] });

    expect(screen.getByText("menu.saveStatus.otherVersion")).toBeInTheDocument();
    expect(screen.getByText("menu.saveStatus.unreadable")).toBeInTheDocument();
  });

  it("shows no tag on a save that loads", () => {
    renderList({ saves: [{ ...save, status: "ok" as const, format_version: 3 }, save] });

    expect(screen.queryByText("menu.saveStatus.otherVersion")).not.toBeInTheDocument();
    expect(screen.queryByText("menu.saveStatus.unreadable")).not.toBeInTheDocument();
  });

  it("says which format an other-version save was written with", () => {
    renderList({ saves: [otherVersion] });

    expect(screen.getByText(/menu\.saveStatus\.otherVersionReason.*"found":4/)).toBeInTheDocument();
  });

  it("does not load a save it cannot read when it is clicked", () => {
    const props = renderList({ saves: [otherVersion, unreadable] });

    fireEvent.click(loadButton(/Newer career/));
    fireEvent.click(loadButton(/Broken career/));

    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("does not load a save it cannot read when Enter or Space is pressed on it", () => {
    const props = renderList({ saves: [otherVersion] });
    const button = loadButton(/Newer career/);

    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });

    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("still loads a save that is fine, by click and by Enter", () => {
    const props = renderList({ saves: [{ ...save, status: "ok" as const, format_version: 3 }] });
    const button = loadButton(/Career/);

    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });

    expect(props.onLoad).toHaveBeenCalledTimes(2);
  });

  it("marks Load as aria-disabled, not natively disabled, so the keyboard still reaches it", () => {
    renderList({ saves: [otherVersion] });
    const button = loadButton(/Newer career/);

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("gives the blocked Load the reason as its accessible description", () => {
    renderList({ saves: [otherVersion, unreadable] });

    expect(loadButton(/Newer career/)).toHaveAccessibleDescription(
      /menu\.saveStatus\.otherVersionReason.*"found":4/,
    );
    expect(loadButton(/Broken career/)).toHaveAccessibleDescription("menu.saveStatus.unreadableReason");
  });

  it("gives a save that loads no description and no aria-disabled", () => {
    renderList({ saves: [save] });
    const button = loadButton(/Career/);

    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("moves keyboard focus onto the row of a save it cannot read", () => {
    renderList({ saves: [otherVersion] });

    expect(loadButton(/Newer career/)).toHaveFocus();
  });

  it("walks the arrow keys over saves it cannot read", () => {
    renderList({ saves: [save, otherVersion, unreadable] });

    fireEvent.keyDown(loadButton(/Career/), { key: "ArrowDown" });
    expect(loadButton(/Newer career/)).toHaveFocus();
    fireEvent.keyDown(loadButton(/Newer career/), { key: "ArrowDown" });
    expect(loadButton(/Broken career/)).toHaveFocus();
  });

  it("keeps export and delete working on saves it cannot read", () => {
    const props = renderList({ saves: [otherVersion, unreadable] });
    const [exportFirst, exportSecond] = screen.getAllByRole("button", { name: "menu.transfer.export" });
    const [deleteFirst, deleteSecond] = screen.getAllByRole("button", { name: "menu.deleteSave" });

    fireEvent.click(exportFirst);
    fireEvent.click(exportSecond);
    fireEvent.click(deleteFirst);
    fireEvent.click(deleteSecond);

    expect(vi.mocked(props.onExport).mock.calls).toEqual([["v4"], ["bad"]]);
    expect(vi.mocked(props.onConfirmDelete).mock.calls).toEqual([["v4"], ["bad"]]);
    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("leaves the Enter key to the export button instead of swallowing it", () => {
    const props = renderList({ saves: [otherVersion] });

    const notCancelled = fireEvent.keyDown(screen.getByRole("button", { name: "menu.transfer.export" }), {
      key: "Enter",
    });

    expect(notCancelled).toBe(true);
    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("leaves the Enter key to the delete button instead of swallowing it", () => {
    renderList({ saves: [otherVersion] });

    const notCancelled = fireEvent.keyDown(screen.getByRole("button", { name: "menu.deleteSave" }), {
      key: "Enter",
    });

    expect(notCancelled).toBe(true);
  });

  it("keeps the reason on screen while the delete confirmation is open", () => {
    renderList({ saves: [otherVersion], confirmDeleteId: "v4" });

    expect(screen.getByText(/menu\.saveStatus\.otherVersionReason/)).toBeInTheDocument();
  });

  it("always has an element for every aria-describedby reference", () => {
    for (const confirmDeleteId of [null, "v4", "bad"]) {
      const { container, unmount } = render(
        <SavesList
          {...{
            saves: [otherVersion, unreadable],
            isLoading: false,
            confirmDeleteId,
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
          }}
        />,
      );
      for (const el of container.querySelectorAll("[aria-describedby]")) {
        expect(document.getElementById(el.getAttribute("aria-describedby")!)).not.toBeNull();
      }
      unmount();
    }
  });

  describe("Enter follows the focused row, not the stored index", () => {
    const rowA = { ...save, id: "a", name: "Alpha career" };
    const rowB = { ...save, id: "b", name: "Bravo career" };
    const taggedB = { ...rowB, status: "other_version" as const, format_version: 4 };

    it("loads nothing when focus moved to a tagged save's Load and the index stayed on another row", () => {
      const props = renderList({ saves: [rowA, taggedB] });

      act(() => loadButton(/Bravo career/).focus());
      fireEvent.keyDown(loadButton(/Bravo career/), { key: "Enter" });

      expect(props.onLoad).not.toHaveBeenCalled();
    });

    it("loads the focused row, not the row the index was on", () => {
      const props = renderList({ saves: [rowA, rowB] });

      act(() => loadButton(/Bravo career/).focus());
      fireEvent.keyDown(loadButton(/Bravo career/), { key: "Enter" });

      expect(vi.mocked(props.onLoad).mock.calls).toEqual([["b"]]);
    });

    it("moves the index to the row whose button was clicked", () => {
      renderList({ saves: [rowA, rowB] });

      fireEvent.click(screen.getAllByRole("button", { name: "menu.transfer.export" })[1]);

      expect(loadButton(/Bravo career/)).toHaveAttribute("tabindex", "0");
      expect(loadButton(/Alpha career/)).toHaveAttribute("tabindex", "-1");
    });

    it("moves the index to the row that takes focus", () => {
      renderList({ saves: [rowA, rowB] });

      act(() => loadButton(/Bravo career/).focus());

      expect(loadButton(/Bravo career/)).toHaveAttribute("tabindex", "0");
    });

    it("leaves focus on the export button that was focused instead of pulling it back to Load", () => {
      renderList({ saves: [rowA, rowB] });
      const exportB = screen.getAllByRole("button", { name: "menu.transfer.export" })[1];

      act(() => exportB.focus());

      expect(exportB).toHaveFocus();
    });
  });
});
