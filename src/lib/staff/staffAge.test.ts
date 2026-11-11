import { describe, expect, it } from "vitest";

import { PLACEHOLDER_STAFF_BIRTH_DATE, staffAge } from "./staffAge";

const TODAY = "2026-08-10T00:00:00Z";

describe("staffAge", () => {
  it("returns the age for a real birth date", () => {
    expect(staffAge({ date_of_birth: "1985-03-01" }, TODAY)).toBe(41);
  });

  it("is unknown for the placeholder date the data gives every staff member", () => {
    expect(staffAge({ date_of_birth: PLACEHOLDER_STAFF_BIRTH_DATE }, TODAY)).toBeNull();
  });

  it("is unknown for a missing birth date", () => {
    expect(staffAge({ date_of_birth: "" }, TODAY)).toBeNull();
  });

  it("is unknown for a birth date that does not parse", () => {
    expect(staffAge({ date_of_birth: "not-a-date" }, TODAY)).toBeNull();
  });
});
