import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TagBlock } from "@/ui-v2/components/ui/tag-block";

describe("TagBlock", () => {
  it("renders its text with neutral/md defaults", () => {
    render(<TagBlock>Blocker</TagBlock>);

    const tag = screen.getByText("Blocker");
    expect(tag).toHaveAttribute("data-slot", "tag-block");
    expect(tag).toHaveAttribute("data-tone", "neutral");
    expect(tag).toHaveAttribute("data-size", "md");
    expect(tag).toHaveClass("font-heading", "font-bold");
  });

  it.each(["club", "secondary", "neutral", "warning", "positive", "negative", "info"] as const)(
    "exposes the %s tone as a data attribute and a plate colour",
    (tone) => {
      render(<TagBlock tone={tone}>Label</TagBlock>);
      const tag = screen.getByText("Label");
      expect(tag).toHaveAttribute("data-tone", tone);
      expect(tag.className).toMatch(/before:bg-/);
    }
  );

  it("never goes below 0.75rem on any size", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { unmount } = render(<TagBlock size={size}>Tag</TagBlock>);
      const tag = screen.getByText("Tag");
      expect(tag).toHaveAttribute("data-size", size);
      expect(tag.className).not.toMatch(/text-\[\d+px\]/);
      unmount();
    }
  });

  it("skews the plate with the --tag-skew token and keeps text upright", () => {
    render(<TagBlock>Slanted</TagBlock>);
    const tag = screen.getByText("Slanted");
    expect(tag.className).toContain("before:[transform:skewX(var(--tag-skew");
    expect(tag.className).not.toMatch(/(^|\s)skew/);
  });

  it("drops the skew when slant is false", () => {
    render(<TagBlock slant={false}>Flat</TagBlock>);
    const tag = screen.getByText("Flat");
    expect(tag).toHaveAttribute("data-slant", "false");
    expect(tag.className).toContain("before:transform-none");
    expect(tag.className).not.toContain("skewX");
  });

  it("draws the outline from the --tag-outline-width and --tag-outline-color tokens", () => {
    render(<TagBlock>Outlined</TagBlock>);
    const cls = screen.getByText("Outlined").className;
    expect(cls).toContain("var(--tag-outline-width,0px)");
    expect(cls).toContain("var(--tag-outline-color,currentColor)");
  });

  it("renders a decorative icon hidden from assistive tech", () => {
    render(
      <TagBlock icon={<svg data-testid="icon" />}>With icon</TagBlock>
    );
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("With icon")).toBeInTheDocument();
  });

  it("merges a custom className", () => {
    render(<TagBlock className="extra">Merged</TagBlock>);
    expect(screen.getByText("Merged")).toHaveClass("extra");
  });
});
