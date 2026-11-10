import { describe, expect, it } from "vitest";

import { staffErrorKey } from "./staffErrors";

describe("staffErrorKey", () => {
  it("maps a coded backend refusal to its translation key", () => {
    const wire = JSON.stringify({ kind: "staff", reason: "owner_not_fireable" });

    expect(staffErrorKey(wire)).toBe("staff.errors.owner_not_fireable");
    expect(staffErrorKey(new Error(wire))).toBe("staff.errors.owner_not_fireable");
  });

  it("never exposes a raw internal error", () => {
    const raw = "Failed to record staff hiring transaction: ZeroAmount";

    expect(staffErrorKey(raw)).toBe("staff.errors.generic");
    expect(staffErrorKey(new Error(raw))).toBe("staff.errors.generic");
  });

  it("falls back to the generic message for an unknown reason or kind", () => {
    expect(staffErrorKey(JSON.stringify({ kind: "staff", reason: "brand_new" }))).toBe("staff.errors.generic");
    expect(staffErrorKey(JSON.stringify({ kind: "invalid_logo", reason: "no_game" }))).toBe("staff.errors.generic");
    expect(staffErrorKey(undefined)).toBe("staff.errors.generic");
  });
});
