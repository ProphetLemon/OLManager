import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyShield, TeamShield } from "./TeamShield";

const withLogo = { name: "Dark Club", tag: "DRK", logoUrl: "/teams-icons/dark.png" };

describe("TeamShield outline", () => {
  it("puts a 1 px outline in the text colour on a logo, through the theme's token", () => {
    const { container } = render(<TeamShield identity={withLogo} size="small" />);
    const img = container.querySelector("img") as HTMLElement;
    expect(img.className).toContain("drop-shadow(1px_0_0_var(--foreground))");
    expect(img.className).toContain("drop-shadow(-1px_0_0_var(--foreground))");
    expect(img.className).toContain("drop-shadow(0_1px_0_var(--foreground))");
    expect(img.className).toContain("drop-shadow(0_-1px_0_var(--foreground))");
    expect(img.className).not.toMatch(/#[0-9a-f]{3,6}|rgb|oklch/i);
  });

  it("keeps the empty shield's dashed outline and gives it no filter", () => {
    const { container } = render(<EmptyShield size="small" />);
    const empty = container.querySelector('[data-slot="phone-empty-shield"]') as HTMLElement;
    expect(empty.className).toContain("border-dashed");
    expect(empty.className).not.toContain("drop-shadow");
  });
});
