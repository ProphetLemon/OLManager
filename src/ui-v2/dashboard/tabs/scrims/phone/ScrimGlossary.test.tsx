import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { dismissOverlayWithBack, resetNativeBackOverlaysForTests } from "@/ui-v2/palette/paletteHistory";
import { GlossaryButton } from "./ScrimGlossary";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  resetNativeBackOverlaysForTests();
  await i18n.changeLanguage("en");
});

const open = () => fireEvent.click(screen.getByRole("button", { name: "What each number means" }));
const dialog = () => document.querySelector('[data-slot="glossary-dialog"]') as HTMLElement | null;

describe("GlossaryButton", () => {
  it("is a button of one target that opens a dialog titled What each number means", () => {
    render(<GlossaryButton />);
    const trigger = screen.getByRole("button", { name: "What each number means" });
    expect(trigger.className).toContain("size-[var(--hit)]");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(dialog()).toBeNull();
    open();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("What each number means");
  });

  it("lists how to read the changes, then Quality, Morale, Energy, Scrim rep and Cancellations, in that order, with the owner's sentences", () => {
    render(<GlossaryButton />);
    open();
    const entries = [...document.querySelectorAll('[data-slot="glossary-entry"]')] as HTMLElement[];
    expect(entries.map((entry) => entry.getAttribute("data-entry"))).toEqual(["read", "quality", "morale", "energy", "reputation", "cancellations"]);
    expect(entries[0]).toHaveTextContent("How to read the changes");
    expect(entries[0]).toHaveTextContent("«+6 → 65» means quality ends at 65. A cost is what you pay for cancelling a block.");
    expect(entries[1]).toHaveTextContent("How well the block went, from 30 to 95.");
    expect(entries[2]).toHaveTextContent("How your five starters feel.");
    expect(entries[3]).toHaveTextContent("How rested your five starters are.");
    expect(entries[4]).toHaveTextContent("Each cancelled block costs 5 and it does not come back.");
    expect(entries[5]).toHaveTextContent("How many blocks you have cancelled this week. It starts again every week.");
  });

  it("speaks Spanish as the owner wrote it", async () => {
    await i18n.changeLanguage("es");
    render(<GlossaryButton />);
    fireEvent.click(screen.getByRole("button", { name: "Qué significa cada dato" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Cómo leer los cambios");
    expect(screen.getByRole("dialog")).toHaveTextContent("Cada bloque cancelado resta 5 y no se recupera.");
  });

  it("closes with its own 48 px close button", () => {
    render(<GlossaryButton />);
    open();
    const close = within(dialog() as HTMLElement).getByRole("button", { name: "Close" });
    expect(close.className).toContain("size-[var(--hit)]");
    fireEvent.click(close);
    expect(dialog()).toBeNull();
  });

  it("is closed first by the system's Back", () => {
    render(<GlossaryButton />);
    open();
    expect(dialog()).not.toBeNull();
    act(() => {
      expect(dismissOverlayWithBack()).toBe(true);
    });
    expect(dialog()).toBeNull();
  });

  it("fits at 804 x 360 without scrolling in two columns: the icon sits beside the title and the sentence takes the column's width", () => {
    render(<GlossaryButton />);
    open();
    // 12 + 40 header + 8 + three rows of 84 and two gaps of 8 = 316 of 344 (worst case 340): no scroll in English or Spanish.
    expect(dialog()!.className).toContain("max-h-[calc(100dvh-1rem)]");
    expect(dialog()!.className).toContain("p-3");
    const grid = dialog()!.querySelector("dl") as HTMLElement;
    expect(grid.className).toContain("grid-cols-2");
    const entry = dialog()!.querySelector('[data-slot="glossary-entry"]') as HTMLElement;
    const dt = entry.querySelector("dt") as HTMLElement;
    expect(dt.querySelector("svg")).not.toBeNull();
    expect(entry.className).toContain("flex-col");
  });

  it("scrolls inside its own body, with a fade at the edge that has more, for a locale that needs more room", () => {
    render(<GlossaryButton />);
    open();
    const scroller = dialog()!.querySelector('[data-slot="glossary-scroll"]') as HTMLElement;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("min-h-0");
    expect(scroller.style.maskImage || scroller.getAttribute("style")).toBeTruthy();
    expect(dialog()!.className).toContain("flex-col");
  });

  it("says five where the owner's text says five, in every locale", async () => {
    const five: Record<string, RegExp> = { en: /five starters/, es: /cinco titulares/, de: /fünf Stammspieler/, fr: /cinq titulaires/, it: /cinque titolari/, pt: /cinco titulares/, "pt-BR": /cinco titulares/, tr: /İlk beş/ };
    for (const [code, pattern] of Object.entries(five)) {
      await i18n.changeLanguage(code);
      for (const key of ["scrims.phone.glossaryMoraleBody", "scrims.phone.glossaryEnergyBody"]) expect(i18n.t(key), `${code} ${key}`).toMatch(pattern);
    }
    expect(i18n.t("scrims.phone.glossaryMoraleBody", { lng: "tr" })).not.toContain("on bir");
  });

  it("keeps the French register of the file: vous, votre, vos, never tu, ton, tes", async () => {
    await i18n.changeLanguage("fr");
    const text = ["glossaryReadBody", "glossaryQualityBody", "glossaryMoraleBody", "glossaryEnergyBody", "glossaryRepBody", "glossaryCancelBody"].map((key) => i18n.t(`scrims.phone.${key}`)).join(" ");
    expect(text).toMatch(/\b(vous|votre|vos)\b/);
    expect(text).not.toMatch(/(?<![\p{L}])(tu|ton|ta|tes|te)(?![\p{L}])/iu);
  });
});
