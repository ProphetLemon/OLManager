import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { DashboardAlert } from "@/lib/dashboard/helpers";
import type { BlockerData } from "@/services/advanceTimeService";
import type { PlayerData } from "@/store/gameStore";
import { buildCallItems } from "./needsYourCall";

const t = ((key: string, opts?: { defaultValue?: string; count?: number }) =>
  (opts?.defaultValue ?? key).replace("{{count}}", String(opts?.count ?? ""))) as unknown as TFunction;

const NOW = "2026-01-01";

const blocker = (id: string, extra: Partial<BlockerData> = {}): BlockerData => ({
  id,
  severity: "warn",
  text: `text ${id}`,
  tab: "Squad",
  ...extra,
});

const alert = (id: string, severity: "warn" | "info" = "warn"): DashboardAlert => ({
  id,
  text: `alert ${id}`,
  tab: "Finances",
  severity,
});

const player = (id: string, contractEnd: string | null): PlayerData =>
  ({ id, match_name: `P${id}`, full_name: `Player ${id}`, contract_end: contractEnd }) as PlayerData;

const build = (over: Partial<Parameters<typeof buildCallItems>[0]> = {}) =>
  buildCallItems({
    alerts: [],
    blockers: [],
    canContinueAnyway: false,
    startingFive: [],
    currentDate: NOW,
    t,
    ...over,
  });

describe("buildCallItems decisions", () => {
  it("does not count a notice (info alert) as a decision", () => {
    const result = build({ alerts: [alert("scrim_auto_delegate_notice", "info")] });
    expect(result.total).toBe(1);
    expect(result.decisions).toBe(0);
  });

  it("counts blockers and warning alerts but not the notices next to them", () => {
    const result = build({
      alerts: [alert("scrim_auto_delegate_notice", "info"), alert("finance_crisis")],
      blockers: [blocker("scrim_decision_required")],
    });
    expect(result.total).toBe(3);
    expect(result.decisions).toBe(2);
  });
});

describe("buildCallItems", () => {
  it("returns an empty result for empty input", () => {
    expect(build()).toEqual({ items: [], total: 0, hiddenContracts: 0, decisions: 0 });
  });

  it.each([
    ["incomplete_lineup", "fixLineup"],
    ["main_roster_minimum", "fixLineup"],
    ["main_missing_roles", "fixLineup"],
    ["academy_missing_roles", "openAcademy"],
    ["key_contract_risk", "openContracts"],
    ["contract_wage_risk", "openContracts"],
    ["scrim_setup_required", "openScrims"],
    ["scrim_decision_required", "openScrims"],
    ["urgent_messages", "openInbox"],
    ["something_new", "review"],
  ])("maps blocker %s to action %s", (id, action) => {
    const [item] = build({ blockers: [blocker(id)] }).items;
    expect(item.kind).toBe("blocker");
    expect(item.id).toBe(`blocker:${id}`);
    expect(item.tagKey).toBe("onAir.tags.blocker");
    expect(item.actionLabelKey).toBe(`onAir.calls.actions.${action}`);
    expect(item.headline).toBe(`text ${id}`);
    expect(item.consequence).toBeTruthy();
  });

  it("sends the academy blocker to the academy tab with an academy action, not the first team's", () => {
    const [item] = build({ blockers: [blocker("academy_missing_roles", { tab: "YouthAcademy" })] }).items;
    expect(item.actionLabelKey).toBe("onAir.calls.actions.openAcademy");
    expect(item.actionLabelKey).not.toBe("onAir.calls.actions.fixLineup");
    expect(item.target.tab).toBe("Youth");
  });

  it("words a blocker without a rule from its own consequence key before the generic one", () => {
    const keyed = ((key: string, opts?: { defaultValue?: string }) =>
      key === "onAir.calls.consequence.advance_blocked" ? "own text" : (opts?.defaultValue ?? key)) as unknown as TFunction;
    const [own] = build({ blockers: [blocker("advance_blocked")], t: keyed }).items;
    expect(own.consequence).toBe("own text");
    const [other] = build({ blockers: [blocker("zzz", { severity: "info" })], t: keyed }).items;
    expect(other.consequence).toBe("Review this before moving on.");
  });

  it("derives hard vs soft from canContinueAnyway", () => {
    expect(build({ blockers: [blocker("incomplete_lineup")] }).items[0].severity).toBe("hard");
    const soft = build({ blockers: [blocker("incomplete_lineup")], canContinueAnyway: true }).items[0];
    expect(soft.severity).toBe("soft");
    expect(soft.tagTone).toBe("warning");
  });

  it("keeps scrim blockers hard and urgent messages info", () => {
    const { items } = build({
      canContinueAnyway: true,
      blockers: [blocker("urgent_messages", { severity: "info" }), blocker("scrim_setup_required")],
    });
    expect(items.map((i) => [i.id, i.severity])).toEqual([
      ["blocker:scrim_setup_required", "hard"],
      ["blocker:urgent_messages", "info"],
    ]);
    expect(items[0].target.tab).toBe("Scrims");
  });

  it("keeps every backend-enforced blocker hard even when Continue anyway was offered", () => {
    const { items } = build({
      canContinueAnyway: true,
      blockers: [blocker("scrim_decision_required"), blocker("advance_blocked")],
    });
    expect(items.map((i) => i.severity)).toEqual(["hard", "hard"]);
  });

  it("degrades unknown blockers to review and keeps the backend tab", () => {
    const [item] = build({ blockers: [blocker("zzz", { tab: "Finances" })] }).items;
    expect(item.actionLabelKey).toBe("onAir.calls.actions.review");
    expect(item.target.tab).toBe("Finances");
    expect(item.consequence).toBe("Review this before moving on.");
  });

  it.each([
    "exhausted",
    "incomplete_lineup",
    "urgent",
    "finance_crisis",
    "finance_runway",
    "sponsor_theme_esports",
    "wage_pressure",
    "match_lineup",
    "scrim_auto_delegate_notice",
  ])("maps alert %s without throwing", (id) => {
    const [item] = build({ alerts: [alert(id)] }).items;
    expect(item.kind).toBe("alert");
    expect(item.tagKey).toBe("onAir.tags.alert");
    expect(item.actionLabelKey).toMatch(/^onAir\.calls\.actions\./);
  });

  it("maps alert severity warn to soft and info to info", () => {
    const { items } = build({ alerts: [alert("a", "info"), alert("b", "warn")] });
    expect(items.map((i) => i.severity)).toEqual(["soft", "info"]);
    expect(items[1].tagTone).toBe("info");
  });

  it("drops alerts that duplicate a blocker", () => {
    const { items } = build({
      blockers: [blocker("incomplete_lineup"), blocker("urgent_messages")],
      alerts: [alert("incomplete_lineup"), alert("urgent"), alert("match_lineup"), alert("exhausted")],
    });
    expect(items.map((i) => i.id).sort()).toEqual([
      "alert:exhausted",
      "blocker:incomplete_lineup",
      "blocker:urgent_messages",
    ]);
  });

  it("only emits contract rows for critical or warning risk, ignoring null ends", () => {
    const { items } = build({
      startingFive: [
        player("a", "2026-03-01"), // critical
        player("b", "2026-10-01"), // warning
        player("c", "2030-01-01"), // stable
        player("d", null),
      ],
    });
    expect(items.map((i) => [i.id, i.severity, i.tagTone])).toEqual([
      ["contract:a", "soft", "negative"],
      ["contract:b", "info", "warning"],
    ]);
    expect(items[0].actionLabelKey).toBe("onAir.calls.actions.renew");
    expect(items[0].target).toEqual({ tab: "Squad", context: { playerId: "a" } });
    expect(items[0].consequence).toBe("Expires in 59 days");
  });

  it("caps contract rows by maxContracts and reports the hidden count", () => {
    const startingFive = ["1", "2", "3", "4", "5"].map((n, i) =>
      player(n, `2026-0${i + 2}-01`),
    );
    const capped = build({ startingFive, blockers: [blocker("incomplete_lineup")] });
    expect(capped.items.filter((i) => i.kind === "contract")).toHaveLength(3);
    expect(capped.hiddenContracts).toBe(2);
    expect(capped.total).toBe(6);
    // the soonest expiries stay visible
    expect(capped.items.filter((i) => i.kind === "contract").map((i) => i.id)).toEqual([
      "contract:1",
      "contract:2",
      "contract:3",
    ]);
    const custom = build({ startingFive, maxContracts: 1 });
    expect(custom.hiddenContracts).toBe(4);
    expect(custom.total).toBe(5);
    expect(build({ startingFive, maxContracts: 0 }).items).toHaveLength(0);
  });

  it("sorts hard, soft, info with stable insertion order inside a tier", () => {
    const { items } = build({
      canContinueAnyway: true,
      blockers: [blocker("urgent_messages"), blocker("main_missing_roles"), blocker("scrim_setup_required")],
      alerts: [alert("finance_runway")],
      startingFive: [player("z", "2026-02-01")],
    });
    expect(items.map((i) => i.id)).toEqual([
      "blocker:scrim_setup_required",
      "blocker:main_missing_roles",
      "alert:finance_runway",
      "contract:z",
      "blocker:urgent_messages",
    ]);
  });

  it("is deterministic, has unique ids and does not mutate inputs", () => {
    const input = {
      alerts: [alert("a"), alert("a")],
      blockers: [blocker("x"), blocker("x")],
      startingFive: [player("1", "2026-02-01")],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = build(input);
    const second = build(input);
    expect(first).toEqual(second);
    expect(new Set(first.items.map((i) => i.id)).size).toBe(first.items.length);
    expect(input).toEqual(snapshot);
  });
});
