import { describe, expect, it } from "vitest";

import { formatDelegatedNoteParams } from "./delegatedRenewalNotes";

describe("formatDelegatedNoteParams", () => {
  it("formats the wage with the active currency symbol and keeps the other params", () => {
    expect(formatDelegatedNoteParams({ wage: "26000", years: "4" })).toEqual({
      wage: `€${(26000).toLocaleString()}`,
      years: "4",
    });
  });

  it("does not mutate the params it receives", () => {
    const params = { wage: "26000", years: "4" };
    formatDelegatedNoteParams(params);
    expect(params.wage).toBe("26000");
  });

  it("leaves params without a numeric wage untouched", () => {
    expect(formatDelegatedNoteParams(undefined)).toBeUndefined();
    expect(formatDelegatedNoteParams({})).toEqual({});
    expect(formatDelegatedNoteParams({ wage: "" })).toEqual({ wage: "" });
    expect(formatDelegatedNoteParams({ wage: "n/a" })).toEqual({ wage: "n/a" });
  });
});
