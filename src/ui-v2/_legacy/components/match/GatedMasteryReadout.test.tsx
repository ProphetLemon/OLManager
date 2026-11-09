import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GatedMasteryReadout from "@/ui-v2/_legacy/components/match/GatedMasteryReadout";

describe("GatedMasteryReadout", () => {
  it("renders the exact number when known", () => {
    render(<GatedMasteryReadout reading={{ kind: "exact", value: 77 }} />);
    expect(screen.getByText("77")).toBeTruthy();
  });

  it("renders only a band label with an explanatory tooltip when not scouted", () => {
    const { container } = render(
      <GatedMasteryReadout reading={{ kind: "band", band: "high", sortValue: 85 }} />,
    );
    expect(screen.getByText(/high/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.querySelector("[title]")).not.toBeNull();
  });
});
