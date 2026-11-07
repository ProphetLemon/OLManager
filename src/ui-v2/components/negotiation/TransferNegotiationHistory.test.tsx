import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatVal } from "@/lib/common/helpers";
import type { TransferOfferData } from "@/store/gameStore";
import TransferNegotiationHistory from "@/ui-v2/components/negotiation/TransferNegotiationHistory";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function offer(overrides: Partial<TransferOfferData> = {}): TransferOfferData {
  return {
    id: "o1",
    fee: 900_000,
    negotiation_round: 2,
    last_manager_fee: 700_000,
    suggested_counter_fee: 850_000,
    ...overrides,
  } as TransferOfferData;
}

describe("TransferNegotiationHistory", () => {
  it("renders nothing before the second round", () => {
    const { container } = render(
      <TransferNegotiationHistory offer={offer({ negotiation_round: 1 })} mode="outgoing" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the manager's last bid and the club's signal when outgoing", () => {
    render(<TransferNegotiationHistory offer={offer()} mode="outgoing" />);
    expect(screen.getByText("transfers.lastBidLabel")).toBeInTheDocument();
    expect(screen.getByText(formatVal(700_000))).toBeInTheDocument();
    expect(screen.getByText("transfers.lastClubSignalLabel")).toBeInTheDocument();
    expect(screen.getByText(formatVal(850_000))).toBeInTheDocument();
  });

  it("uses the incoming labels and falls back to the offer fee", () => {
    render(
      <TransferNegotiationHistory
        offer={offer({ last_manager_fee: null, suggested_counter_fee: null })}
        mode="incoming"
      />,
    );
    expect(screen.queryByText("transfers.lastCounterLabel")).not.toBeInTheDocument();
    expect(screen.getByText("transfers.currentOfferLabel")).toBeInTheDocument();
    expect(screen.getByText(formatVal(900_000))).toBeInTheDocument();
  });
});
