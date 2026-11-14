import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaveFile } from "@/api/types";
import SavesList from "./SavesList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
  it("exports the save whose button was pressed without loading it", () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: "menu.transfer.export" }));

    expect(props.onExport).toHaveBeenCalledWith("a");
    expect(props.onLoad).not.toHaveBeenCalled();
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
