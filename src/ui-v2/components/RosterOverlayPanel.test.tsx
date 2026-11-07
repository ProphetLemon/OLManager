import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRosterOverlay } from "@/hooks/useRosterOverlay";
import type { WorldOverlayInfo } from "@/services/worldOverlayService";

const mocks = vi.hoisted(() => ({
  getWorldOverlayInfo: vi.fn(),
  updateWorldOverlay: vi.fn(),
}));

vi.mock("@/services/worldOverlayService", () => ({
  getWorldOverlayInfo: mocks.getWorldOverlayInfo,
  updateWorldOverlay: mocks.updateWorldOverlay,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (_key: string, fallback: string, options?: Record<string, string>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => options?.[name] ?? ""),
  }),
}));

import { RosterOverlayPanel } from "./RosterOverlayPanel";

function makeInfo(overrides: Partial<WorldOverlayInfo> = {}): WorldOverlayInfo {
  return {
    as_of: "2026-06-22",
    origin: "bundled",
    source: {
      name: "Leaguepedia",
      url: "https://lol.fandom.com",
      license: "CC BY-SA 3.0",
      license_url: "https://www.fandom.com/licensing",
      attribution: "Roster data from Leaguepedia, available under CC BY-SA 3.0.",
    },
    player_ops: 12,
    staff_ops: 3,
    updated: false,
    ...overrides,
  };
}

function Harness() {
  const overlay = useRosterOverlay();
  return (
    <RosterOverlayPanel
      info={overlay.info}
      status={overlay.status}
      error={overlay.error}
      onUpdate={overlay.update}
    />
  );
}

describe("RosterOverlayPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorldOverlayInfo.mockResolvedValue(makeInfo());
  });

  it("renders nothing until the overlay info is known", () => {
    const { container } = render(
      <RosterOverlayPanel info={null} status="idle" error={null} onUpdate={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the roster date and the licence attribution with its link", async () => {
    render(<Harness />);

    expect(await screen.findByText("Rosters as of June 22, 2026")).toBeInTheDocument();
    expect(screen.getByText(/Roster data: Leaguepedia contributors,/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "CC BY-SA 3.0" });
    expect(link).toHaveAttribute("href", "https://www.fandom.com/licensing");
  });

  it("does not link a licence URL that the overlay supplies", async () => {
    mocks.getWorldOverlayInfo.mockResolvedValue(
      makeInfo({
        source: { ...makeInfo().source, license: "Proprietary", license_url: "https://evil.example/pwn" },
      }),
    );
    render(<Harness />);

    expect(await screen.findByText(/Proprietary/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links the known licence to a hard-coded URL, ignoring the overlay's", async () => {
    mocks.getWorldOverlayInfo.mockResolvedValue(
      makeInfo({
        source: { ...makeInfo().source, license_url: "https://evil.example/pwn" },
      }),
    );
    render(<Harness />);

    const link = await screen.findByRole("link", { name: "CC BY-SA 3.0" });
    expect(link).toHaveAttribute("href", "https://www.fandom.com/licensing");
  });

  it("never falls back to window.open when the opener plugin fails", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    render(<Harness />);

    fireEvent.click(await screen.findByRole("link", { name: "CC BY-SA 3.0" }));
    await new Promise((r) => setTimeout(r, 20));

    expect(open).not.toHaveBeenCalled();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    open.mockRestore();
  });

  it("shows the new date after a successful update", async () => {
    mocks.updateWorldOverlay.mockResolvedValue(
      makeInfo({ as_of: "2026-11-01", origin: "downloaded", updated: true }),
    );
    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: "Update rosters" }));

    expect(await screen.findByText("Rosters updated to November 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Rosters as of November 1, 2026")).toBeInTheDocument();
    expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
  });

  it("says rosters are already up to date when nothing changed", async () => {
    mocks.updateWorldOverlay.mockResolvedValue(makeInfo({ updated: false }));
    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: "Update rosters" }));

    expect(await screen.findByText("Rosters already up to date")).toBeInTheDocument();
  });

  it("disables the button and shows progress while updating", async () => {
    let resolve: (info: WorldOverlayInfo) => void = () => {};
    mocks.updateWorldOverlay.mockReturnValue(
      new Promise<WorldOverlayInfo>((r) => {
        resolve = r;
      }),
    );
    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: "Update rosters" }));

    const busy = await screen.findByRole("button", { name: "Updating..." });
    expect(busy).toBeDisabled();
    resolve(makeInfo());
    await waitFor(() => expect(screen.getByRole("button", { name: "Update rosters" })).toBeEnabled());
  });

  it("shows a non-blocking error and keeps the current date when the update fails", async () => {
    mocks.updateWorldOverlay.mockRejectedValue("roster overlay download failed: offline");
    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: "Update rosters" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update rosters: roster overlay download failed: offline. You can still start with the current rosters.",
    );
    expect(screen.getByText("Rosters as of June 22, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update rosters" })).toBeEnabled();
  });

  it("still renders the panel when reading the overlay info fails", async () => {
    mocks.getWorldOverlayInfo.mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<Harness />);

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    warn.mockRestore();
  });

  it("shows progress copy and disables the button while the automatic check runs", () => {
    render(<RosterOverlayPanel info={makeInfo()} status="checking" error={null} onUpdate={() => {}} />);

    expect(screen.getByText("Checking for roster updates…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update rosters" })).toBeDisabled();
    expect(screen.getByText("Rosters as of June 22, 2026")).toBeInTheDocument();
  });

  it("shows a quiet notice, not the error alert, when the automatic check failed", () => {
    const onUpdate = vi.fn();
    render(<RosterOverlayPanel info={makeInfo()} status="checkFailed" error={null} onUpdate={onUpdate} />);

    expect(screen.getByText("Couldn't check for roster updates. Using the rosters shown.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Rosters as of June 22, 2026")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Update rosters" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("stays silent when idle after an up-to-date automatic check", () => {
    render(<RosterOverlayPanel info={makeInfo()} status="idle" error={null} onUpdate={() => {}} />);

    expect(screen.queryByText(/Checking for roster updates/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't check/)).not.toBeInTheDocument();
    expect(screen.queryByText("Rosters already up to date")).not.toBeInTheDocument();
  });
});
