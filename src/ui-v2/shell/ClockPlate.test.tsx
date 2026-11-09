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
    expect(tag).toHaveAttribute("data-tone", "neutral");
    expect(group.querySelector('[data-slot="tag-block-icon"]')).not.toBeNull();
  });

  it("omits the phase tag when no phase is given", () => {
    render(<ClockPlate dateLabel="12 Jan" />);
    expect(document.querySelector('[data-slot="tag-block"]')).toBeNull();
  });

  it("falls back to a generic icon for unknown phases", () => {
    render(<ClockPlate dateLabel="12 Jan" phase={{ key: "Mystery", label: "Mystery" }} />);
    expect(document.querySelector('[data-slot="tag-block-icon"]')).not.toBeNull();
  });
});
