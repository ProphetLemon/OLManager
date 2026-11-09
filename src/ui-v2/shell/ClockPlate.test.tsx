import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClockPlate } from "@/ui-v2/shell/ClockPlate";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

describe("ClockPlate", () => {
  it("exposes the date and phase as one labelled group", () => {
    render(<ClockPlate dateLabel="12 Jan" phase={{ key: "Morning", label: "Morning" }} />);
    const group = screen.getByRole("group", { name: "Game date and phase" });
    expect(within(group).getByText("12 Jan")).toBeInTheDocument();
    const tag = group.querySelector('[data-slot="tag-block"]');
    expect(tag).toHaveTextContent("Morning");
    expect(tag).toHaveAttribute("data-tone", "club");
    expect(tag?.className).toContain("text-club-foreground");
    expect(group.querySelector('[data-slot="tag-block-icon"]')).not.toBeNull();
  });

  it("omits the phase tag when no phase is given", () => {
    render(<ClockPlate dateLabel="12 Jan" />);
    expect(document.querySelector('[data-slot="tag-block"]')).toBeNull();
  });

  it("renders the date on a Barlow plate that rounds fully when alone", () => {
    render(<ClockPlate dateLabel="12 Jan" />);
    const date = screen.getByText("12 Jan");
    expect(date.className).toContain("font-heading");
    expect(date.className).toContain("text-[1.25rem]");
    expect(date.className).toContain("rounded-lg");
  });

  it("shows the phase label it is given, never the raw key", () => {
    render(<ClockPlate dateLabel="12 Jan" phase={{ key: "Morning", label: "Mañana" }} />);
    expect(screen.getByText("Mañana")).toBeInTheDocument();
    expect(screen.queryByText("Morning")).toBeNull();
  });
});
