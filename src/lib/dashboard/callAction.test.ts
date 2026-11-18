import { describe, expect, it } from "vitest";

import type { CallItem } from "./needsYourCall";
import { callAction } from "./callAction";

const item = (over: Partial<CallItem>): CallItem => ({
  id: "x",
  kind: "blocker",
  severity: "hard",
  tagKey: "onAir.tags.blocker",
  tagTone: "negative",
  headline: "Headline",
  actionLabelKey: "onAir.calls.actions.review",
  target: { tab: "Squad" },
  ...over,
});

describe("callAction", () => {
  it("opens the player with the renewal flow for a contract with a playerId", () => {
    const contract = item({
      id: "contract:p1",
      kind: "contract",
      target: { tab: "Squad", context: { playerId: "p1" } },
    });
    expect(callAction(contract)).toEqual({ kind: "player", id: "p1", openRenewal: true });
  });

  it("sends a blocker to its tab with its context", () => {
    const blocker = item({
      id: "blocker:incomplete_lineup",
      target: { tab: "Scrims", context: { competitionId: "lec" } },
    });
    expect(callAction(blocker)).toEqual({
      kind: "tab",
      tab: "Scrims",
      context: { competitionId: "lec" },
    });
  });

  it("sends a blocker without context to its tab", () => {
    expect(callAction(item({ target: { tab: "Squad" } }))).toEqual({
      kind: "tab",
      tab: "Squad",
      context: undefined,
    });
  });

  it("sends a contract without a playerId to its tab, not to a profile", () => {
    const contract = item({ kind: "contract", target: { tab: "Squad", context: {} } });
    expect(callAction(contract)).toEqual({ kind: "tab", tab: "Squad", context: {} });
  });
});
