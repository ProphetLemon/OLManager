import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/store/settingsStore";
import Settings from "./Settings";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/hooks/useUpdater", () => ({
  useUpdater: () => ({
    updateAvailable: false,
    updateInfo: null,
    checking: false,
    noPlatformBuild: false,
    check: vi.fn(),
  }),
}));

function openSavesAndExport() {
  useSettingsStore.setState({ loaded: true });
  render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /saves/i }));
  fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
}

describe("Settings export world", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    invokeMock.mockReset();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("asks the backend for a bare file name and shows the path it wrote", async () => {
    invokeMock.mockResolvedValue("/home/me/.local/share/app/exports/exported_world.json");

    openSavesAndExport();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Exported to: /home/me/.local/share/app/exports/exported_world.json",
    );
    expect(invokeMock).toHaveBeenCalledWith("export_world_database", { exportPath: "exported_world.json" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps showing the path instead of letting it vanish after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      invokeMock.mockResolvedValue("/data/exports/exported_world.json");
      openSavesAndExport();
      await screen.findByRole("status");

      await vi.advanceTimersByTimeAsync(30_000);

      expect(screen.getByRole("status")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an error and logs it when the export fails", async () => {
    invokeMock.mockRejectedValue("Failed to write /data/exports/exported_world.json: Permission denied");

    openSavesAndExport();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not export the world: Failed to write /data/exports/exported_world.json: Permission denied",
    );
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("Failed to export world:", expect.anything()));
  });

  it("clears an old error when a retry succeeds", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce("/data/exports/w.json");
    openSavesAndExport();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("/data/exports/w.json");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
