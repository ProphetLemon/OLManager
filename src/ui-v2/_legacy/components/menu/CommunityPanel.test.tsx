import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommunityPanel from "./CommunityPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string }) =>
      typeof opts === "string" ? opts : (opts?.defaultValue ?? key),
  }),
}));

const FORK_URLS = [
  "https://github.com/ProphetLemon/OLManager",
  "https://github.com/ProphetLemon/OLManager/releases/latest",
];

describe("CommunityPanel", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  function clickAllLinks(): string[] {
    render(<CommunityPanel onClose={() => {}} />);
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => b.textContent !== "");
    for (const button of buttons) fireEvent.click(button);
    return openSpy.mock.calls.map((call: unknown[]) => String(call[0]));
  }

  it("opens exactly the two Limón Edition URLs", () => {
    expect(clickAllLinks().sort()).toEqual([...FORK_URLS].sort());
  });

  it("never opens a URL of the original project", () => {
    for (const url of clickAllLinks()) {
      expect(url).not.toMatch(/OpenLeagueManager|discord|x\.com/i);
    }
  });

  it("does not render the mentions section when there are no supporters", () => {
    render(<CommunityPanel onClose={() => {}} />);
    expect(screen.queryByText(/Menciones/)).toBeNull();
    expect(screen.queryByText(/Discord/i)).toBeNull();
  });

  it("keeps arrow-key focus inside the two links", () => {
    render(<CommunityPanel onClose={() => {}} />);
    const links = screen.getAllByRole("button").filter((b) => b.textContent !== "");
    expect(links).toHaveLength(2);
    links[0].focus();
    fireEvent.keyDown(links[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
  });
});
