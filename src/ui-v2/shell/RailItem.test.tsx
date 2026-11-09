import { fireEvent, render, screen } from "@testing-library/react";
import { Mail } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { RailItem } from "./RailItem";

describe("RailItem", () => {
  it("marks the active stop with aria-current, a bar and bold weight", () => {
    render(<RailItem icon={Mail} label="Inbox" active onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Inbox" });
    expect(button).toHaveAttribute("aria-current", "page");
    expect(button.querySelector('[data-slot="rail-item-bar"]')).not.toBeNull();
    expect(button.querySelector(".font-bold")).not.toBeNull();
  });

  it("has no current marker or bar when inactive", () => {
    render(<RailItem icon={Mail} label="Inbox" onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Inbox" });
    expect(button).not.toHaveAttribute("aria-current");
    expect(button.querySelector('[data-slot="rail-item-bar"]')).toBeNull();
  });

  it("exposes the badge count in the accessible name and caps it", () => {
    const { rerender } = render(<RailItem icon={Mail} label="Inbox" badge={3} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Inbox, 3" })).toHaveTextContent("3");
    rerender(<RailItem icon={Mail} label="Inbox" badge={250} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Inbox, 99+" })).toBeInTheDocument();
  });

  it("hides a zero badge", () => {
    render(<RailItem icon={Mail} label="Inbox" badge={0} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Inbox" })).not.toHaveTextContent(/\d/);
  });

  it("keeps the full label as title and fires onClick", () => {
    const onClick = vi.fn();
    render(<RailItem icon={Mail} label="Champions of the world" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Champions of the world" });
    expect(button).toHaveAttribute("title", "Champions of the world");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("compact mode keeps the name but hides the visible label", () => {
    render(<RailItem icon={Mail} label="Inbox" compact onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
  });

  it("gives the active stop a high-contrast outline besides the bar and fill", () => {
    render(<RailItem icon={Mail} label="Inbox" active onClick={vi.fn()} />);
    const cls = screen.getByRole("button", { name: "Inbox" }).className;
    expect(cls).toContain("[[data-contrast=high]_&]:data-[active=true]:outline-2");
    expect(cls).toContain("[[data-contrast=high]_&]:data-[active=true]:outline-solid");
  });

  it("keeps labels at 0.75rem or larger", () => {
    render(<RailItem icon={Mail} label="Inbox" onClick={vi.fn()} />);
    expect(screen.getByText("Inbox").className).toContain("text-[0.75rem]");
  });

  it("describes a launcher through aria-description and the tooltip", () => {
    render(<RailItem icon={Mail} label="Club" hint="Squad, Tactics" onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Club" });
    expect(button).toHaveAttribute("aria-description", "Squad, Tactics");
    expect(button).toHaveAttribute("title", "Club: Squad, Tactics");
  });
});
