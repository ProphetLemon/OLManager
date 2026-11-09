import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreNumeral } from "@/ui-v2/components/ui/score-numeral";

describe("ScoreNumeral", () => {
  it("is decorative (aria-hidden) without a label", () => {
    render(<ScoreNumeral value={87} />);

    const el = screen.getByText("87");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveClass("font-heading", "font-extrabold", "tabular-nums", "leading-none");
  });

  it("uses the label as its accessible name and drops aria-hidden", () => {
    render(<ScoreNumeral value={87} label="Overall 87" />);

    const el = screen.getByRole("img", { name: "Overall 87" });
    expect(el).not.toHaveAttribute("aria-hidden");
  });

  it.each([
    ["ovr", "text-ovr"],
    ["scoreboard", "text-scoreboard"],
    ["title", "text-title"],
  ] as const)("maps size %s to %s", (size, cls) => {
    render(<ScoreNumeral value="3" size={size} />);
    expect(screen.getByText("3")).toHaveClass(cls);
  });

  it.each([
    ["foreground", "text-foreground"],
    ["club", "text-club-text"],
    ["muted", "text-muted-foreground"],
  ] as const)("maps tone %s to %s", (tone, cls) => {
    render(<ScoreNumeral value="3" tone={tone} />);
    expect(screen.getByText("3")).toHaveClass(cls);
  });
});
