import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SaveFile, SaveImportPreview, SaveRepository } from "@/api/types";
import { useSaveTransfer } from "./useSaveTransfer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const entry = { id: "a", name: "Career" } as SaveFile;
const preview = (replaces: SaveFile | null): SaveImportPreview => ({
  name: "Career",
  manager_name: "John Smith",
  replaces,
});

function repo(overrides: Partial<SaveRepository>): SaveRepository {
  return {
    exportToFile: vi.fn().mockResolvedValue(null),
    pickImport: vi.fn().mockResolvedValue(null),
    confirmImport: vi.fn().mockResolvedValue(entry),
    cancelImport: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SaveRepository;
}

function setup(overrides: Partial<SaveRepository>) {
  const saves = repo(overrides);
  const onImported = vi.fn();
  const view = renderHook(() => useSaveTransfer(() => saves, onImported));
  return { saves, onImported, ...view };
}

describe("useSaveTransfer", () => {
  it("imports straight away when the id is new and reloads the list", async () => {
    const { result, saves, onImported } = setup({
      pickImport: vi.fn().mockResolvedValue(preview(null)),
    });

    await act(() => result.current.startImport());

    expect(saves.confirmImport).toHaveBeenCalledWith(false);
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(result.current.notice?.tone).toBe("success");
  });

  it("asks before replacing and stores nothing until the user confirms", async () => {
    const { result, saves } = setup({
      pickImport: vi.fn().mockResolvedValue(preview(entry)),
    });

    await act(() => result.current.startImport());

    expect(result.current.pendingReplace?.name).toBe("Career");
    expect(saves.confirmImport).not.toHaveBeenCalled();

    await act(() => result.current.confirmReplace());

    expect(saves.confirmImport).toHaveBeenCalledWith(true);
    expect(result.current.pendingReplace).toBeNull();
  });

  it("drops the staged import when the user declines the replacement", async () => {
    const { result, saves } = setup({
      pickImport: vi.fn().mockResolvedValue(preview(entry)),
    });
    await act(() => result.current.startImport());

    await act(() => result.current.cancelReplace());

    expect(saves.cancelImport).toHaveBeenCalledTimes(1);
    expect(saves.confirmImport).not.toHaveBeenCalled();
    expect(result.current.pendingReplace).toBeNull();
  });

  it("does nothing visible when the picker is cancelled", async () => {
    const { result, onImported } = setup({});

    await act(() => result.current.startImport());

    expect(result.current.notice).toBeNull();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("words a wrong-version refusal with its own message and leaves the list alone", async () => {
    const { result, onImported } = setup({
      pickImport: vi.fn().mockRejectedValue("wrong_version|The file is from another game version"),
    });

    await act(() => result.current.startImport());

    expect(result.current.notice).toEqual({
      tone: "error",
      text: "menu.transfer.error.wrong_version",
    });
    expect(onImported).not.toHaveBeenCalled();
  });

  it("shows the backend text for an error it has no code for", async () => {
    const { result } = setup({ pickImport: vi.fn().mockRejectedValue("Lock error: x") });

    await act(() => result.current.startImport());

    expect(result.current.notice?.text).toContain("Lock error: x");
  });

  it("confirms a successful export and stays quiet when the dialog is cancelled", async () => {
    const done = setup({ exportToFile: vi.fn().mockResolvedValue("/tmp/a.olsave") });
    await act(() => done.result.current.exportSave("a"));
    expect(done.result.current.notice).toEqual({ tone: "success", text: "menu.transfer.exported" });

    const cancelled = setup({});
    await act(() => cancelled.result.current.exportSave("a"));
    expect(cancelled.result.current.notice).toBeNull();
  });
});
