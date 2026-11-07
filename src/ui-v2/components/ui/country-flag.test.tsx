import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";

describe("CountryFlag", () => {
  it("renders an SVG flag for valid country codes", () => {
    const { container } = render(<CountryFlag code="GB" locale="en" />);

    expect(screen.getByRole("img", { name: "United Kingdom" })).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("returns null for invalid country codes", () => {
    const { container } = render(<CountryFlag code="ZZ" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a text badge fallback for football nation codes without SVG assets", () => {
    render(<CountryFlag code="ENG" locale="en" />);

    expect(screen.getByRole("img", { name: "England" })).toHaveTextContent("ENG");
  });
});