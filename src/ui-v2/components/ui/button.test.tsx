import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "@/ui-v2/components/ui/badge";
import { Button } from "@/ui-v2/components/ui/button";

describe("Button variants and sizes", () => {
  it("club variant uses the club tokens and a ring offset", () => {
    render(<Button variant="club">Continue</Button>);
    const btn = screen.getByRole("button", { name: "Continue" });
    expect(btn).toHaveClass("bg-club", "text-club-foreground", "focus-visible:ring-offset-2");
  });

  it("touch sizes use the --hit token", () => {
    render(
      <>
        <Button size="touch">Go</Button>
        <Button size="icon-touch" aria-label="Save" />
      </>
    );
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("h-[var(--hit)]", "min-w-[var(--hit)]");
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("size-[var(--hit)]");
  });

  it("link variant is tinted with the club text colour", () => {
    render(<Button variant="link">More</Button>);
    expect(screen.getByRole("button")).toHaveClass("text-club-text");
    expect(screen.getByRole("button")).not.toHaveClass(["text", "primary"].join("-"));
  });
});

describe("Badge status variants", () => {
  it.each(["positive", "warning", "info", "negative"] as const)("%s uses its token", (variant) => {
    render(<Badge variant={variant}>Status</Badge>);
    expect(screen.getByText("Status")).toHaveClass(`bg-${variant}/15`, `text-${variant}`, `border-${variant}/40`);
  });
});
