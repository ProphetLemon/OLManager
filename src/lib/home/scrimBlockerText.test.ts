import { describe, expect, it } from "vitest";

import { localizeAdvanceBlocker } from "@/services/advanceTimeService";
import { scrimBlockerText } from "./scrimBlockerText";

describe("scrimBlockerText", () => {
  it("is the single source of the scrim blocker wording", () => {
    const setup = scrimBlockerText("scrim_setup_required");
    const decision = scrimBlockerText("scrim_decision_required");
    expect(setup).not.toBe(decision);
    expect(
      localizeAdvanceBlocker({ id: "scrim_setup_required", severity: "warn", tab: "Scrims", text: "raw" }).text,
    ).toBe(setup);
    expect(
      localizeAdvanceBlocker({ id: "scrim_decision_required", severity: "warn", tab: "Scrims", text: "raw" }).text,
    ).toBe(decision);
    expect(localizeAdvanceBlocker({ id: "incomplete_lineup", severity: "warn", tab: "Squad", text: "raw" }).text).toBe("raw");
  });
});
