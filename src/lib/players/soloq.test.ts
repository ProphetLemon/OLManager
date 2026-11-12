import { describe, expect, it } from "vitest";
import { tierFromLp } from "./soloq";

describe("tierFromLp", () => {
  it("reads Master at 0 LP: the floor of the ladder is Master 0 LP, not unranked", () => {
    expect(tierFromLp(0)).toBe("Master");
  });

  it("keeps the tier cut-offs", () => {
    expect(tierFromLp(799)).toBe("Master");
    expect(tierFromLp(800)).toBe("Grandmaster");
    expect(tierFromLp(1299)).toBe("Grandmaster");
    expect(tierFromLp(1300)).toBe("Challenger");
  });

  it("is unranked only when there is no value at all", () => {
    expect(tierFromLp(null)).toBe("Unranked");
    expect(tierFromLp(undefined)).toBe("Unranked");
    expect(tierFromLp(Number.NaN)).toBe("Unranked");
  });
});
