import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatVal } from "@/lib/common/helpers";
import NegotiationFeedbackPanel from "@/ui-v2/components/negotiation/NegotiationFeedbackPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "transfers.wageFeedbackOverBudgetDetail") return `Only ${params?.wage} of room`;
      return key;
    },
  }),
}));

describe("NegotiationFeedbackPanel", () => {
  it("formats the wage param as money instead of a raw integer", () => {
    render(
      <NegotiationFeedbackPanel
        feedback={{
          mood: "guarded",
          headline_key: "transfers.wageFeedbackOverBudgetHeadline",
          detail_key: "transfers.wageFeedbackOverBudgetDetail",
          tension: 40,
          patience: 60,
          round: 1,
          params: { wage: "123456" },
        }}
        titleKey="title"
        roundKey="round"
        patienceKey="patience"
        tensionKey="tension"
      />,
    );

    expect(screen.getByText(`Only ${formatVal(123456)} of room`)).toBeTruthy();
    expect(screen.queryByText(/123456/)).toBeNull();
  });
});
