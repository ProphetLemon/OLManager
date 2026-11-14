import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { crestInitial, SideCrest } from "./SideCrest";

const CLUB = { name: "Shifters", tag: "SHFT", logoUrl: "/teams-icons/shifters.webp" };

describe("SideCrest", () => {
  it("shows the logo, decorative, in the shape of its side", () => {
    const { container } = render(<SideCrest side="red" identity={CLUB} />);
    const crest = container.querySelector(".arena-crest")!;
    expect(crest).toHaveAttribute("data-team", "red");
    expect(crest).toHaveAttribute("aria-hidden", "true");
    expect(crest).not.toHaveAttribute("data-fallback");
    expect(crest.querySelector("img")).toHaveAttribute("src", "/teams-icons/shifters.webp");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the club's initial on its fill when there is no logo", () => {
    const { container } = render(<SideCrest side="blue" identity={{ ...CLUB, logoUrl: null }} />);
    const crest = container.querySelector(".arena-crest")!;
    expect(crest).toHaveAttribute("data-fallback", "true");
    expect(crest).toHaveTextContent("S");
    expect(crest.querySelector("img")).toBeNull();
  });

  it("falls back to the initial when the logo fails, and tries a new logo again", () => {
    const { container, rerender } = render(<SideCrest side="blue" identity={CLUB} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector(".arena-crest")).toHaveAttribute("data-fallback", "true");
    rerender(<SideCrest side="blue" identity={{ ...CLUB, logoUrl: "/teams-icons/other.webp" }} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/teams-icons/other.webp");
  });

  it("takes its size from the caller", () => {
    const { container } = render(<SideCrest side="blue" identity={CLUB} size="3rem" />);
    expect((container.querySelector(".arena-crest") as HTMLElement).style.getPropertyValue("--crest-size")).toBe("3rem");
  });

  it("reads the initial from the name, then from the tag", () => {
    expect(crestInitial({ name: " tides", tag: "TDL" })).toBe("T");
    expect(crestInitial({ name: "  ", tag: "tdl" })).toBe("T");
  });
});
