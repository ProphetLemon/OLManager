import { describe, expect, it } from "vitest";

import es from "./locales/es.json";

describe("Spanish term for the player's physical condition", () => {
  it("uses one term in the squad column and on the player card", () => {
    expect(es.onAir.squad.fitness.toLowerCase()).toBe(es.common.fitness.toLowerCase());
  });
});
