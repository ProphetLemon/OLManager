import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NEXT_BLOCK_CANCELLATION,
  POST_DECISION_EFFECTS,
  SEVERE_LOSS,
  SEVERE_PUSH_THROUGH,
  type DecisionEffects,
  type PostScrimDecisionName,
} from "./decisionEffects";

const SQUAD_RS = readFileSync(resolve(__dirname, "../../../src-tauri/src/commands/squad.rs"), "utf-8");

/** The source of `apply_post_scrim_decision_internal`, the one function that applies a decision. */
function applyFunction(): string {
  const start = SQUAD_RS.indexOf("fn apply_post_scrim_decision_internal(");
  expect(start, "apply_post_scrim_decision_internal in squad.rs").toBeGreaterThan(-1);
  const end = SQUAD_RS.indexOf("\n}\n", start);
  return SQUAD_RS.slice(start, end + 3);
}

/** Every `PostScrimDecision::Name => { ... }` arm of the function, with its braces balanced. */
function arms(source: string): Array<{ name: string; body: string }> {
  const found: Array<{ name: string; body: string }> = [];
  const open = /PostScrimDecision::(\w+) => \{/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(source))) {
    let depth = 1;
    let index = open.lastIndex;
    while (depth > 0 && index < source.length) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    found.push({ name: match[1], body: source.slice(open.lastIndex, index - 1) });
  }
  return found;
}

const signed = (direction: string, amount: string) => (direction === "sub" ? -1 : 1) * Number(amount);

function field(body: string, owner: "report" | "player", name: string): number {
  const pattern = new RegExp(
    `${owner}\\s*\\.${name}\\s*=\\s*${owner}\\s*\\.${name}\\s*\\.saturating_(add|sub)\\(\\s*(\\d+)\\s*\\)`,
  );
  const match = body.match(pattern);
  return match ? signed(match[1], match[2]) : 0;
}

describe("decision effects mirror squad.rs", () => {
  const source = applyFunction();
  const all = arms(source);

  function parsed(): Record<string, DecisionEffects> {
    const out: Record<string, DecisionEffects> = {};
    for (const { name, body } of all) {
      const effects = (out[name] ??= { quality: 0, severity: 0, morale: 0, condition: 0 });
      if (body.includes("report.")) {
        effects.quality += field(body, "report", "quality");
        effects.severity += field(body, "report", "severity");
      }
      if (body.includes("player.")) {
        effects.morale += field(body, "player", "morale");
        effects.condition += field(body, "player", "condition");
      }
    }
    return out;
  }

  it("reads one report arm and one player arm for every decision", () => {
    const names = [...new Set(all.map((arm) => arm.name))].sort();
    expect(names).toEqual(Object.keys(POST_DECISION_EFFECTS).sort());
    for (const name of names) {
      const bodies = all.filter((arm) => arm.name === name);
      expect(bodies.filter((arm) => arm.body.includes("report.")), `report arm of ${name}`).toHaveLength(1);
      expect(bodies.filter((arm) => arm.body.includes("player.")), `player arm of ${name}`).toHaveLength(1);
    }
  });

  it("applies the same quality, severity, morale and condition as the table, except Push through's condition", () => {
    const rust = parsed();
    for (const [name, effects] of Object.entries(POST_DECISION_EFFECTS) as Array<[PostScrimDecisionName, DecisionEffects]>) {
      const expected = { ...effects };
      // Push through's condition is `if severe_or_context_push { 8 } else { 6 }`, checked below.
      if (name === "PushThrough") expected.condition = 0;
      // Push through's morale drop is conditional too, checked below.
      if (name === "PushThrough") expected.morale = 0;
      const actual = { ...rust[name] };
      if (name === "PushThrough") {
        actual.condition = 0;
        actual.morale = 0;
      }
      expect(actual, name).toEqual(expected);
    }
  });

  it("keeps Push through's condition and morale for a normal and a severe loss", () => {
    const push = all.find((arm) => arm.name === "PushThrough" && arm.body.includes("player."))!.body;
    const condition = push.match(/saturating_sub\(\s*if severe_or_context_push \{ (\d+) \} else \{ (\d+) \}\s*\)/);
    expect(condition, "condition branch of Push through").not.toBeNull();
    expect(-Number(condition![1])).toBe(SEVERE_PUSH_THROUGH.condition);
    expect(-Number(condition![2])).toBe(POST_DECISION_EFFECTS.PushThrough.condition);
    const morale = push.match(/if severe_or_context_push \{\s*player\.morale = player\.morale\.saturating_sub\((\d+)\)/);
    expect(morale, "morale branch of Push through").not.toBeNull();
    expect(-Number(morale![1])).toBe(SEVERE_PUSH_THROUGH.morale);
  });

  it("calls a loss severe by the same three tests", () => {
    const severe = source.match(
      /let severe_or_context_push = !won\s*&& \(severity >= (\d+)\s*\|\| own_loss_streak >= (\d+)\s*\|\| own_scrim_reputation >= opponent_scrim_reputation\.saturating_add\((\d+)\)\);/,
    );
    expect(severe, "severe_or_context_push in squad.rs").not.toBeNull();
    expect([Number(severe![1]), Number(severe![2]), Number(severe![3])]).toEqual([
      SEVERE_LOSS.severity,
      SEVERE_LOSS.lossStreak,
      SEVERE_LOSS.reputationLead,
    ]);
  });

  it("charges every cancelled second block the same reputation and cancellation", () => {
    const cancellations = [...source.matchAll(/scrim_weekly_cancellations\s*=\s*team\s*\.scrim_weekly_cancellations\s*\.saturating_add\((\d+)\)/g)];
    const reputation = [...source.matchAll(/scrim_reputation\s*=\s*team\.scrim_reputation\.saturating_sub\((\d+)\)/g)];
    expect(cancellations.length).toBeGreaterThan(0);
    expect(reputation.length).toBe(cancellations.length);
    cancellations.forEach((match) => expect(Number(match[1])).toBe(NEXT_BLOCK_CANCELLATION.cancellations));
    reputation.forEach((match) => expect(-Number(match[1])).toBe(NEXT_BLOCK_CANCELLATION.reputation));
  });

  it("cancels the second block for every first-block decision except Push through and Continue", () => {
    expect(source).toMatch(
      /if decision != olm_core::domain::team::PostScrimDecision::PushThrough\s*&& decision != olm_core::domain::team::PostScrimDecision::ContinuePlan/,
    );
  });
});
