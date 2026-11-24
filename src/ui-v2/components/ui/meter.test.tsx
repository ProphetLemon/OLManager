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
  it("draws no mark by default", () => {
    render(<Meter value={40} label="Win" />);
    expect(screen.getByRole("meter").querySelector("[data-slot=meter-tick]")).toBeNull();
  });

  it("draws a decorative mark at the given value, scaled to max, without changing the reading", () => {
    render(<Meter value={58} label="Win" valueText="58%" tick={50} />);
    const meter = screen.getByRole("meter", { name: "Win" });
    const tick = meter.querySelector("[data-slot=meter-tick]");
    expect(tick).toHaveStyle({ left: "50%" });
    expect(tick).toHaveAttribute("aria-hidden", "true");
    expect(meter).toHaveAttribute("aria-valuenow", "58");
    expect(meter).toHaveAttribute("aria-valuetext", "58%");
    expect(screen.getByText("58%")).toBeInTheDocument();
  });

  it("scales the mark to a custom max and clamps it into the bar", () => {
    const { rerender } = render(<Meter value={3} max={10} label="Form" tick={5} />);
    expect(screen.getByRole("meter").querySelector("[data-slot=meter-tick]")).toHaveStyle({ left: "50%" });
    rerender(<Meter value={3} max={10} label="Form" tick={99} />);
    expect(screen.getByRole("meter").querySelector("[data-slot=meter-tick]")).toHaveStyle({ left: "100%" });
  });
});
