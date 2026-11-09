import { describe, expect, it, vi } from "vitest";

import {
  buildBlockerModal,
  canContinueAnyway,
  isBackendEnforcedBlocker,
  resolveAdvanceMode,
} from "./blockerRules";

const lineup = { id: "incomplete_lineup", severity: "warn", tab: "Squad", text: "Lineup" };
const setup = { id: "scrim_setup_required", severity: "warn", tab: "Scrims", text: "Setup" };
const decision = { id: "scrim_decision_required", severity: "warn", tab: "Scrims", text: "Decision" };

describe("resolveAdvanceMode", () => {
  it("delegates for an unemployed manager and keeps the requested mode otherwise", () => {
    expect(resolveAdvanceMode(true, "live")).toBe("delegate");
    expect(resolveAdvanceMode(false, "spectator")).toBe("spectator");
  });
});

describe("backend-enforced blockers", () => {
  it("flags the scrim stops and the advance failures, not the roster warnings", () => {
    expect(isBackendEnforcedBlocker(setup)).toBe(true);
    expect(isBackendEnforcedBlocker(decision)).toBe(true);
    expect(isBackendEnforcedBlocker({ id: "advance_blocked" })).toBe(true);
    expect(isBackendEnforcedBlocker(lineup)).toBe(false);
  });

  it("never offers Continue anyway when one enforced blocker is in the list", () => {
    expect(canContinueAnyway([lineup])).toBe(true);
    expect(canContinueAnyway([lineup, setup])).toBe(false);
    expect(canContinueAnyway([decision])).toBe(false);
  });

  it("builds a modal with pendingAction only when Continue anyway can work", () => {
    const action = vi.fn();
    expect(buildBlockerModal([lineup], action).pendingAction).toBe(action);
    expect(buildBlockerModal([lineup, decision], action).pendingAction).toBeUndefined();
    expect(buildBlockerModal([lineup]).pendingAction).toBeUndefined();
  });
});
