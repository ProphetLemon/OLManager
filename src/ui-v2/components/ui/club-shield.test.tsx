import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClubShield } from "@/ui-v2/components/ui/club-shield";

describe("ClubShield", () => {
  it("renders the logo hidden from assistive tech by default", () => {
    const { container } = render(<ClubShield name="Rift Lions" logoUrl="/logo.png" />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/logo.png");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes the club name when not decorative", () => {
    render(<ClubShield name="Rift Lions" logoUrl="/logo.png" decorative={false} />);

    const img = screen.getByRole("img", { name: "Rift Lions" });
    expect(img).toHaveAttribute("alt", "Rift Lions");
    expect(img).not.toHaveAttribute("aria-hidden");
  });

  it("falls back to a two-letter monogram when there is no logo", () => {
    render(<ClubShield name="rift Lions" logoUrl={null} />);

    const shield = screen.getByText("RI");
    expect(shield).toHaveAttribute("data-fallback", "true");
    expect(shield).toHaveAttribute("aria-hidden", "true");
    expect(shield).toHaveStyle({ backgroundColor: "var(--club)" });
  });

  it("falls back to the monogram when the logo fails to load", () => {
    const { container } = render(<ClubShield name="Nova" logoUrl="/broken.png" accent="rgb(1, 2, 3)" />);

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("NO")).toHaveStyle({ backgroundColor: "rgb(1, 2, 3)" });
  });

  it("names the monogram when not decorative", () => {
    render(<ClubShield name="Nova" decorative={false} />);
    expect(screen.getByRole("img", { name: "Nova" })).toHaveTextContent("NO");
  });

  it("retries a new logo after a previous failure", () => {
    const { container, rerender } = render(<ClubShield name="Nova" logoUrl="/broken.png" />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    rerender(<ClubShield name="Nova" logoUrl="/fixed.png" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "/fixed.png");
  });

  it.each([
    ["sm", "size-6"],
    ["md", "size-9"],
    ["lg", "size-12"],
    ["xl", "size-20"],
  ] as const)("maps size %s to %s", (size, cls) => {
    render(<ClubShield name="Nova" size={size} />);
    expect(screen.getByText("NO")).toHaveClass(cls);
  });
});
