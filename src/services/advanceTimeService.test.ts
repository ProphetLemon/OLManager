import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  advanceTimeWithMode,
  checkBlockingActions,
  skipToMatchDay,
} from "./advanceTimeService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("advanceTimeService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("calls the advance-time backend command with the requested mode", async () => {
    const response = { action: "advanced" };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(advanceTimeWithMode("delegate")).resolves.toBe(response);

    expect(mockedInvoke).toHaveBeenCalledWith("advance_time_with_mode", {
      mode: "delegate",
    });
  });

  it("returns blocker data when the blocker command succeeds", async () => {
    const blockers = [
      {
        id: "urgent_messages",
        severity: "info",
        text: "1 urgent unread message(s)",
        tab: "Inbox",
      },
    ];
    mockedInvoke.mockResolvedValueOnce(blockers);

    await expect(checkBlockingActions("test")).resolves.toEqual(blockers);
    expect(mockedInvoke).toHaveBeenCalledWith("check_blocking_actions", {});
  });

  it("sends the mode and the scrim-stop switch to the blocker command", async () => {
    mockedInvoke.mockResolvedValueOnce([]);

    await checkBlockingActions("test", { mode: "delegate", includeScrimStops: false });

    expect(mockedInvoke).toHaveBeenCalledWith("check_blocking_actions", {
      mode: "delegate",
      includeScrimStops: false,
    });
  });

  it("words the backend scrim blockers through i18n and leaves the others untouched", async () => {
    const roster = { id: "main_roster_minimum", severity: "warn", text: "Backend text", tab: "Squad" };
    mockedInvoke.mockResolvedValueOnce([
      roster,
      { id: "scrim_setup_required", severity: "warn", text: "raw", tab: "Scrims" },
      { id: "scrim_decision_required", severity: "warn", text: "raw", tab: "Scrims" },
    ]);

    const blockers = await checkBlockingActions("test");

    expect(blockers[0]).toEqual(roster);
    expect(blockers[1].text).toBe(
      "Define the weekly scrim setup (objective and rivals) or delegate the advance to continue.",
    );
    expect(blockers[2].text).toBe("Make a scrim decision before continuing.");
  });

  it("falls back to an empty blocker list when the blocker command fails", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("boom"));

    await expect(checkBlockingActions("test")).resolves.toEqual([]);
  });

  it("rethrows a failed blocker check when asked to, so callers can keep their state", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("boom"));

    await expect(checkBlockingActions("test", { rethrow: true })).rejects.toThrow("boom");
  });

  it("calls the skip-to-match-day backend command", async () => {
    const response = { action: "advanced", days_skipped: 3 };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(skipToMatchDay()).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("skip_to_match_day");
  });
});