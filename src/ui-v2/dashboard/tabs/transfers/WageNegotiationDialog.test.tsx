import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatVal } from "@/lib/common/helpers";
import type { PlayerData, TeamData } from "@/store/gameStore";
import WageNegotiationDialog from "./WageNegotiationDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "transfers.wageNegotiation") return "Wage Negotiation";
      if (key === "transfers.annualWage") return "Annual wage";
      if (key === "transfers.submitWageOffer") return "Submit Wage Offer";
      if (key === "transfers.submitting") return "Submitting";
      if (key === "transfers.close") return "Close";
      if (key === "transfers.wageAccepted") return "Wage accepted";
      if (key === "transfers.wageRejected") return "Wage rejected";
      if (key === "transfers.wageCountered") return "Wage countered";
      if (key === "transfers.wageBudgetUsage") return "Wage budget usage";
      if (key === "transfers.wageIncrease") return `Raise +${params?.pct}%`;
      if (key === "transfers.wageFeedbackOverBudgetHeadline") return "Over budget";
      if (key === "transfers.wageFeedbackOverBudgetDetail") return `Only ${params?.wage} of room`;
      if (key === "transfers.negotiationPulse") return "Negotiation pulse";
      if (key === "common.freeAgent") return "Free agent";
      return key;
    },
  }),
}));

const player = {
  id: "p1",
  match_name: "J. Smith",
  full_name: "John Smith",
  position: "Forward",
  natural_position: "Forward",
  alternate_positions: [],
  wage: 100_000,
} as unknown as PlayerData;

const teams = [{ id: "t2", name: "Seller FC" }] as unknown as TeamData[];

function renderDialog(overrides: Partial<React.ComponentProps<typeof WageNegotiationDialog>> = {}) {
  const props: React.ComponentProps<typeof WageNegotiationDialog> = {
    target: { player, offerId: "o1", fromTeamId: "t2", fee: 500_000, destinationTeamId: "t1" },
    teams,
    wageAmount: "150000",
    onWageAmountChange: vi.fn(),
    contractYears: 3,
    onContractYearsChange: vi.fn(),
    feedback: null,
    activeOffer: null,
    result: null,
    error: null,
    loading: false,
    onSubmit: vi.fn(),
    onClose: vi.fn(),
    annualWageBudget: 1_000_000,
    ...overrides,
  };
  render(<WageNegotiationDialog {...props} />);
  return props;
}

describe("WageNegotiationDialog", () => {
  it("shows the player, the wage comparison and the budget usage", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("J. Smith")).toBeInTheDocument();
    expect(screen.getByText("Raise +50%")).toBeInTheDocument();
    expect(screen.getByText("Wage budget usage")).toBeInTheDocument();
    expect(screen.getByText("15%")).toBeInTheDocument();
  });

  it("labels free agents instead of showing a selling club", () => {
    renderDialog({ target: { player, offerId: "o1", fromTeamId: null, fee: 0, destinationTeamId: "t1" } });
    expect(screen.getByText("Free agent")).toBeInTheDocument();
  });

  it("flags a wage above the annual budget", () => {
    renderDialog({ wageAmount: "2000000" });
    expect(screen.getByLabelText("Annual wage")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("200%")).toBeInTheDocument();
  });

  it("renders the over-budget wage feedback with money-formatted room", () => {
    renderDialog({
      feedback: {
        mood: "guarded",
        headline_key: "transfers.wageFeedbackOverBudgetHeadline",
        detail_key: "transfers.wageFeedbackOverBudgetDetail",
        tension: 40,
        patience: 60,
        round: 1,
        params: { wage: "123456" },
      },
    });
    expect(screen.getByText("Over budget")).toBeInTheDocument();
    expect(screen.getByText(`Only ${formatVal(123456)} of room`)).toBeInTheDocument();
  });

  it("disables submit for an invalid wage and wires amount, submit and close", () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText("Annual wage"), { target: { value: "175000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Wage Offer" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onWageAmountChange).toHaveBeenCalledWith("175000");
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks submit when the wage is not positive", () => {
    renderDialog({ wageAmount: "0" });
    expect(screen.getByRole("button", { name: "Submit Wage Offer" })).toBeDisabled();
  });

  it("blocks closing and resubmitting once the wage is accepted", () => {
    renderDialog({ result: "accepted" });
    expect(screen.getByText("Wage accepted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit Wage Offer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  });

  it("blocks closing while a submission is in flight", () => {
    renderDialog({ loading: true });
    expect(screen.getByRole("button", { name: "Submitting" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  });

  it("shows rejection and error messages", () => {
    renderDialog({ result: "rejected", error: "Wage too low" });
    expect(screen.getByText("Wage rejected")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Wage too low");
  });

  it("changes the contract length", () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText("transfers.contractLength"), { target: { value: "5" } });
    expect(props.onContractYearsChange).toHaveBeenCalledWith(5);
  });
});
