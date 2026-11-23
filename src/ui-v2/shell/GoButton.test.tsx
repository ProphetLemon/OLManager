import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import de from "@/i18n/locales/de.json";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import fr from "@/i18n/locales/fr.json";
import it_ from "@/i18n/locales/it.json";
import ptBR from "@/i18n/locales/pt-BR.json";
import pt from "@/i18n/locales/pt.json";
import tr from "@/i18n/locales/tr.json";

import { GO_ID, GoButton, type GoVariant } from "./GoButton";
import { GO_ROW_MARGIN_PX } from "./railMode";

const i18n = vi.hoisted(() => {
  const state = { dict: {} as unknown };
  const lookup = (key: string): string | undefined => {
    let node: unknown = state.dict;
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === "string" ? node : undefined;
  };
  return { state, lookup };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => i18n.lookup(key) ?? options?.defaultValue ?? key,
    i18n: { language: "en" },
  }),
}));

const LOCALES = { de, en, es, fr, it: it_, pt, "pt-BR": ptBR, tr };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe.each(Object.entries(LOCALES))("Go's accessible names in %s (R40)", (_locale, dict) => {
  beforeEach(() => {
    i18n.state.dict = dict;
  });

  it("has both keys, and the short one is one word", () => {
    expect(i18n.lookup("onAir.nav.go")).toBeTruthy();
    expect(i18n.lookup("onAir.nav.goShort")).toMatch(/^\S+$/);
  });

  it("names the Tree row by its visible text", () => {
    render(<GoButton variant="row" onClick={() => {}} />);
    const button = screen.getByRole("button");
    const visible = button.textContent?.trim() ?? "";
    expect(visible).toBe(i18n.lookup("onAir.nav.go"));
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).toHaveAccessibleName(new RegExp(escape(visible), "i"));
  });

  it("names the Android stop by its visible short label, with no aria-label", () => {
    render(<GoButton variant="stop" onClick={() => {}} />);
    const button = screen.getByRole("button");
    const visible = button.textContent?.trim() ?? "";
    expect(visible).toBe(i18n.lookup("onAir.nav.goShort"));
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).toHaveAccessibleName(new RegExp(escape(visible), "i"));
  });

  it("names the icon-only cell with aria-label, the text its tip shows", () => {
    render(<GoButton variant="cell" onClick={() => {}} />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-label", i18n.lookup("onAir.nav.go"));
    expect(button).toHaveAccessibleName(i18n.lookup("onAir.nav.go"));
  });
});

describe("GoButton", () => {
  beforeEach(() => {
    i18n.state.dict = en;
  });

  it.each(["row", "cell", "stop"] as GoVariant[])(
    "%s: a button that opens a dialog, with the stable id util:go and never aria-current",
    (variant) => {
      const onClick = vi.fn();
      render(<GoButton variant={variant} onClick={onClick} />);
      const button = screen.getByRole("button");
      expect(GO_ID).toBe("util:go");
      expect(button).toHaveAttribute("id", GO_ID);
      expect(button).toHaveAttribute("data-nav-id", GO_ID);
      expect(button).toHaveAttribute("aria-haspopup", "dialog");
      expect(button).not.toHaveAttribute("aria-current");
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    },
  );

  it("takes its margins from the reserve's GO_ROW_MARGIN_PX, half above and half below", () => {
    render(<GoButton variant="row" onClick={() => {}} />);
    const button = screen.getByRole("button");
    expect(GO_ROW_MARGIN_PX).toBe(10);
    expect(button.style.marginTop).toBe(`${GO_ROW_MARGIN_PX / 2}px`);
    expect(button.style.marginBottom).toBe(`${GO_ROW_MARGIN_PX / 2}px`);
    // One source: no margin class of its own that could drift from the reserve.
    expect(button.className).not.toMatch(/(^|\s)(my|mt|mb)-/);
  });

  it("sizes the Tree row from --go-row, one line, styled like a search field", () => {
    render(<GoButton variant="row" onClick={() => {}} />);
    expect(screen.getByRole("button")).toHaveClass(
      "h-[var(--go-row)]",
      "whitespace-nowrap",
      "border-line",
      "text-muted-foreground",
      "text-nav",
    );
  });

  it("sizes the cell at --nav-cell, and the stop at the touch --hit", () => {
    const { unmount } = render(<GoButton variant="cell" onClick={() => {}} />);
    expect(screen.getByRole("button")).toHaveClass("h-[var(--nav-cell)]");
    unmount();
    render(<GoButton variant="stop" onClick={() => {}} />);
    expect(screen.getByRole("button")).toHaveClass("h-[var(--hit)]");
  });
});
