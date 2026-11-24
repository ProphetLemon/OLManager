import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { ResultBadge } from "./ResultBadge";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

const badge = (container: HTMLElement) => container.querySelector('[data-slot="result-badge"]') as HTMLElement;

describe("ResultBadge", () => {
  it("draws the letter in the positive outline for a win and the negative one for a loss, and says the word to assistive technology", () => {
    const { container, rerender } = render(<ResultBadge result="won" />);
    expect(badge(container)).toHaveAttribute("data-result", "won");
    expect(badge(container).className).toContain("border-positive");
    expect(badge(container)).toHaveTextContent("W");
    expect(badge(container)).toHaveTextContent("Win");
    expect(badge(container)).not.toHaveAttribute("aria-hidden");

    rerender(<ResultBadge result="lost" />);
    expect(badge(container)).toHaveAttribute("data-result", "lost");
    expect(badge(container).className).toContain("border-negative");
    expect(badge(container)).toHaveTextContent("L");
  });

  it("is hidden from assistive technology when a word beside it says the result", () => {
    const { container } = render(<ResultBadge result="won" silent />);
    expect(badge(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("takes its place and size from the caller, which wins over the defaults", () => {
    const { container } = render(<ResultBadge result="won" className="absolute size-[1.375rem] border-2" />);
    expect(badge(container).className).toContain("absolute");
    expect(badge(container).className).toContain("size-[1.375rem]");
    expect(badge(container).className).not.toContain("size-[1.125rem]");
  });
});
