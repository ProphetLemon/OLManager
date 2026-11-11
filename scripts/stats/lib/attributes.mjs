// New nine attributes from an OVR change. Pure and deterministic.
//
// Honesty about what a stat can say (docs: design.md "Honesty about attributes"):
//   measured   - mechanics, laning, teamfighting always; macro_play, consistency, champion_pool only with enough games.
//                They take the full delta (finalOvr - authoredOvr).
//   unmeasured - shotcalling, discipline, mental_resilience and the gated ones below the minimum: no stat backs them,
//                so they only follow the skill with `skill_carry` = 0.75 x delta.
// Rounding then leaves the mean of the nine a little off; a correction spread over the measured attributes first (the
// unmeasured ones only when the measured ones are saturated) brings round(mean of 9) to round(finalOvr) exactly,
// the way olm_core `calculate_lol_ovr` computes it.
import { ATTRIBUTE_NAMES } from "./game-world.mjs";

export const MEASURED_ALWAYS = Object.freeze(["mechanics", "laning", "teamfighting"]);
export const MEASURED_WITH_GAMES = Object.freeze(["macro_play", "consistency", "champion_pool"]);
/** Raw games needed before macro_play, consistency and champion_pool count as measured. */
export const MIN_GAMES_FOR_SOFT = 25;
/** Share of the OVR delta that unmeasured attributes follow. */
export const SKILL_CARRY = 0.75;

const clampAttr = (v) => Math.min(99, Math.max(1, v));
const clampOvr = (v) => Math.min(99, Math.max(1, Math.round(v)));

/**
 * @param input.attributes authored attributes (nine integers)
 * @param input.authoredOvr calculate_lol_ovr of them
 * @param input.finalOvr blended OVR (float)
 * @param input.games raw games behind the estimate
 * @param input.potentialBase authored potential_base
 * @returns {attributes, newOvr, potentialFloor, measured, delta}
 */
export function deriveAttributes({ attributes, authoredOvr, finalOvr, games, potentialBase, minGamesForSoft = MIN_GAMES_FOR_SOFT, skillCarry = SKILL_CARRY }) {
  const delta = finalOvr - authoredOvr;
  const measuredSet = new Set([...MEASURED_ALWAYS, ...(games >= minGamesForSoft ? MEASURED_WITH_GAMES : [])]);
  const measured = ATTRIBUTE_NAMES.filter((name) => measuredSet.has(name));
  const ideal = {};
  const value = {};
  for (const name of ATTRIBUTE_NAMES) {
    ideal[name] = clampAttr(attributes[name] + (measuredSet.has(name) ? delta : skillCarry * delta));
    value[name] = clampAttr(Math.round(ideal[name]));
  }

  const target = clampOvr(finalOvr);
  const lo = 9 * target - 4;
  const hi = 9 * target + 4;
  let sum = ATTRIBUTE_NAMES.reduce((total, name) => total + value[name], 0);
  if (sum < lo || sum > hi) {
    const goal = Math.min(hi, Math.max(lo, Math.round(9 * finalOvr)));
    const step = sum < goal ? 1 : -1;
    // Measured attributes first, then the others; within a group the one furthest from its ideal value in the step direction.
    const unmeasured = ATTRIBUTE_NAMES.filter((name) => !measuredSet.has(name));
    while (sum !== goal) {
      let pick = null;
      for (const group of [measured, unmeasured]) {
        for (const name of group) {
          if (value[name] + step < 1 || value[name] + step > 99) continue;
          const gap = (ideal[name] - value[name]) * step;
          if (pick === null || gap > pick.gap) pick = { name, gap };
        }
        if (pick !== null) break;
      }
      if (pick === null) break;
      value[pick.name] += step;
      sum += step;
    }
  }

  const newOvr = Math.min(99, Math.max(1, Math.round(sum / ATTRIBUTE_NAMES.length)));
  return {
    attributes: Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, value[name]])),
    newOvr,
    potentialFloor: Math.min(99, Math.max(1, newOvr, potentialBase)),
    measured,
    delta,
  };
}
