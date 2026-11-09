import { describe, expect, it } from "vitest";

import { formatVal } from "@/lib/common/helpers";
import { formatFeedbackParams } from "@/lib/transfers/negotiationFeedback";

describe("formatFeedbackParams", () => {
  it("formats the wage like the rest of the transfers UI", () => {
    expect(formatFeedbackParams({ wage: "120000" }).wage).toBe(formatVal(120000));
  });

  it("formats fee amounts sent by the backend", () => {
    const formatted = formatFeedbackParams({ fee: "1500000" });
    expect(formatted.fee).toBe(formatVal(1500000));
    expect(formatted.fee).not.toBe("1500000");
  });

  it("leaves non-money and non-numeric params untouched", () => {
    expect(formatFeedbackParams({ years: "3", fee: "n/a" })).toEqual({ years: "3", fee: "n/a" });
    expect(formatFeedbackParams(undefined)).toEqual({});
  });
});
