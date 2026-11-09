import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Meter } from "@/ui-v2/components/ui/meter";

describe("Meter", () => {
  it("exposes meter semantics with label and value", () => {
    render(<Meter value={72} label="Energy" />);

    const meter = screen.getByRole("meter", { name: "Energy" });
    expect(meter).toHaveAttribute("aria-valuenow", "72");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("aria-valuetext", "72");
  });

  it("always shows the numeric value, using valueText when given", () => {
    const { rerender } = render(<Meter value={72} label="Energy" />);
    expect(screen.getByText("72")).toBeInTheDocument();

    rerender(<Meter value={72} label="Energy" valueText="72%" />);
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "72%");
  });

  it("can hide the visible value but keeps aria-valuetext", () => {
    render(<Meter value={10} label="Morale" showValue={false} />);
    expect(screen.queryByText("10")).toBeNull();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "10");
  });

  it.each([
    [100, "positive"],
    [60, "positive"],
    [59, "warning"],
    [35, "warning"],
    [34, "negative"],
    [0, "negative"],
  ])("auto tone for %i is %s", (value, tone) => {
    render(<Meter value={value} label="Fitness" />);
    expect(screen.getByRole("meter")).toHaveAttribute("data-tone", tone);
  });

  it("uses an explicit tone over the automatic one", () => {
    render(<Meter value={5} label="Fitness" tone="club" />);
    expect(screen.getByRole("meter")).toHaveAttribute("data-tone", "club");
  });

  it("auto tone follows the percentage of a custom max", () => {
    render(<Meter value={5} max={10} label="Form" />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
    expect(meter).toHaveAttribute("data-tone", "warning");
    expect(meter.querySelector("[data-slot=meter-fill]")).toHaveStyle({ width: "50%" });
  });

  it("clamps out-of-range values", () => {
    render(<Meter value={250} label="Energy" />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "100");
    expect(meter.querySelector("[data-slot=meter-fill]")).toHaveStyle({ width: "100%" });
  });
});
