import { describe, expect, it } from "vitest";

import { EMPTY_CALL_STATE, type CallItem, type CallState } from "./needsYourCall";
import { LANE_MIN_BODY_PX, laneModel } from "./attentionLane";

function call(id: string, severity: CallItem["severity"]): CallItem {
  return {
    id,
    kind: "blocker",
    severity,
    tagKey: "onAir.tags.blocker",
    tagTone: "negative",
    headline: `Headline ${id}`,
    actionLabelKey: "onAir.calls.actions.review",
    target: { tab: "Squad" },
  };
}

/** Two decisions and a notice; a contract renewal hidden by the cap makes the count 3. */
function calls(): CallState {
  const decisions = [call("a", "hard"), call("b", "soft")];
  const notice = call("n", "info");
  return {
    items: [...decisions, notice],
    decisionItems: decisions,
    notices: [notice],
    count: 3,
    hiddenContracts: 1,
    total: 4,
  };
}

const shown = { callState: calls(), activeTab: "Squad", compact: false, bodyHeight: 640 };

describe("laneModel (R24)", () => {
  it("shows the decisions off Home, outside compact, with enough body", () => {
    expect(laneModel(shown).visible).toBe(true);
  });

  it("is hidden when nothing needs a decision", () => {
    expect(laneModel({ ...shown, callState: EMPTY_CALL_STATE }).visible).toBe(false);
  });

  it("is hidden on Home, whose panel is the full list", () => {
    expect(laneModel({ ...shown, activeTab: "Home" }).visible).toBe(false);
  });

  it("is hidden on the end-of-season screen", () => {
    expect(laneModel({ ...shown, compact: true }).visible).toBe(false);
  });

  it("gives way below 380 px of body, and shows from 380", () => {
    expect(LANE_MIN_BODY_PX).toBe(380);
    expect(laneModel({ ...shown, bodyHeight: 379 }).visible).toBe(false);
    expect(laneModel({ ...shown, bodyHeight: 380 }).visible).toBe(true);
  });

  it("lists the decisions in order, without the notices, then one pill for Home with the whole count", () => {
    const { pills, count } = laneModel(shown);
    expect(pills.slice(0, -1)).toEqual(
      calls().decisionItems.map((item) => ({ kind: "call", id: item.id, item })),
    );
    expect(pills[pills.length - 1]).toEqual({ kind: "home", id: "lane:home", count: 3 });
    expect(count).toBe(3);
  });

  it("has no pills when it is hidden", () => {
    expect(laneModel({ ...shown, activeTab: "Home" }).pills).toEqual([]);
  });
});
