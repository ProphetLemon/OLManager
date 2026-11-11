import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { formatCurrencyAmount } from "@/lib/formatting/valueFormatting";
import {
  getRenewalStatusClassName,
  getRenewalStatusMessage,
  isRenewalLengthInRange,
  shouldDisableRenewalSubmit,
} from "@/lib/playerProfile/renewal";

const t = (key: string, params?: Record<string, string | number>): string => {
  if (key === "playerProfile.renewalBlocked") {
    return "Talks blocked";
  }

  if (key === "playerProfile.renewalAccepted") {
    return "Offer accepted";
  }

  if (key === "playerProfile.renewalRejected") {
    return "Offer rejected";
  }

  if (key === "playerProfile.renewalCounter") {
    return `Counter ${params?.wage}/${params?.count}`;
  }

  return key;
};

describe("PlayerProfile renewal helpers", () => {
  it("prefers the blocked message when the session is blocked", () => {
    expect(
      getRenewalStatusMessage(
        {
          renewalSessionStatus: "blocked",
          renewalStatus: "idle",
          renewalSuggestedWage: null,
          renewalSuggestedYears: null,
          renewalError: "raw error",
        },
        t,
      ),
    ).toBe("Talks blocked");
  });

  it("formats counter-offer messaging with suggested terms", () => {
    expect(
      getRenewalStatusMessage(
        {
          renewalSessionStatus: "open",
          renewalStatus: "counter_offer",
          renewalSuggestedWage: 16000,
          renewalSuggestedYears: 4,
          renewalError: null,
        },
        t,
      ),
    ).toBe(`Counter ${formatCurrencyAmount(16000)}/4`);
  });

  it("falls back to the raw error when no translated state applies", () => {
    expect(
      getRenewalStatusMessage(
        {
          renewalSessionStatus: "idle",
          renewalStatus: "error",
          renewalSuggestedWage: null,
          renewalSuggestedYears: null,
          renewalError: "backend timeout",
        },
        t,
      ),
    ).toBe("backend timeout");
  });

  it("maps renewal statuses to their display class names", () => {
    expect(getRenewalStatusClassName("accepted")).toBe("text-primary-500");
    expect(getRenewalStatusClassName("rejected")).toBe("text-red-500");
    expect(getRenewalStatusClassName("counter_offer")).toBe(
      "text-accent-600 dark:text-accent-400",
    );
    expect(getRenewalStatusClassName("idle")).toBe(
      "text-gray-500 dark:text-gray-400",
    );
  });

  it("disables submit when any blocking condition is present", () => {
    expect(
      shouldDisableRenewalSubmit({
        renewalSubmitting: false,
        renewalIsTerminal: false,
        isRenewalWageValid: true,
        isRenewalLengthValid: true,
        renewalViolatesSoftCap: false,
      }),
    ).toBe(false);

    expect(
      shouldDisableRenewalSubmit({
        renewalSubmitting: false,
        renewalIsTerminal: false,
        isRenewalWageValid: true,
        isRenewalLengthValid: true,
        renewalViolatesSoftCap: true,
      }),
    ).toBe(true);
  });
});

describe("isRenewalLengthInRange", () => {
  it.each([1, 2, 5])("accepts %i years", (years) => {
    expect(isRenewalLengthInRange(years)).toBe(true);
  });

  it.each([0, 6, 12, -1, 2.5, Number.NaN])("rejects %s years", (years) => {
    expect(isRenewalLengthInRange(years)).toBe(false);
  });
});

describe("renewal counter-offer text", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });

  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  function counterText(wage: number, years: number): string | null {
    return getRenewalStatusMessage(
      {
        renewalSessionStatus: "open",
        renewalStatus: "counter_offer",
        renewalSuggestedWage: wage,
        renewalSuggestedYears: years,
        renewalError: null,
      },
      i18n.t.bind(i18n),
    );
  }

  it("formats the wage with the app's money helper instead of printing the raw number", () => {
    const text = counterText(176000, 3);

    expect(text).toBe(`Quiere más: ${formatCurrencyAmount(176000)}/año por 3 años`);
    expect(text).not.toContain("176000");
  });

  it("uses the singular for a one-year counter", () => {
    expect(counterText(176000, 1)).toBe(`Quiere más: ${formatCurrencyAmount(176000)}/año por 1 año`);
  });
});
