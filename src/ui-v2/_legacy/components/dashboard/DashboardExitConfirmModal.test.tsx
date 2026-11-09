import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DashboardExitConfirmModal from "./DashboardExitConfirmModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string }) =>
      typeof opts === "string" ? opts : (opts?.defaultValue ?? key),
  }),
}));

describe("DashboardExitConfirmModal", () => {
  it("does not claim the game is saved automatically while offering Exit without saving", async () => {
    render(<DashboardExitConfirmModal onCancel={vi.fn()} onConfirm={vi.fn()} onExitWithoutSave={vi.fn()} />);
    const message = await screen.findByText(/Exit without saving discards everything since your last save/);
    expect(message.textContent).not.toMatch(/automatically/i);
  });

  it.each(["de", "en", "es", "fr", "it", "pt", "pt-BR", "tr"])(
    "no longer promises an automatic save in the %s locale",
    async (locale) => {
      const messages = (await import(`@/i18n/locales/${locale}.json`)).default as {
        exitConfirm: { message: string };
      };
      expect(messages.exitConfirm.message).not.toMatch(/automat|otomatik/i);
    },
  );

  it("paints Exit without saving with the shared destructive Button variant", async () => {
    render(<DashboardExitConfirmModal onCancel={vi.fn()} onConfirm={vi.fn()} onExitWithoutSave={vi.fn()} />);
    const exit = await screen.findByRole("button", { name: "Exit without saving" });
    expect(exit).toHaveAttribute("data-slot", "button");
    expect(exit).toHaveClass("bg-destructive/10", "text-destructive");
    expect(exit.className).not.toContain("bg-destructive ");
  });

  it("uses the club variant for Save and exit and routes the actions", async () => {
    const onConfirm = vi.fn();
    const onExitWithoutSave = vi.fn();
    render(<DashboardExitConfirmModal onCancel={vi.fn()} onConfirm={onConfirm} onExitWithoutSave={onExitWithoutSave} />);
    const save = await screen.findByRole("button", { name: "exitConfirm.saveExit" });
    expect(save).toHaveClass("bg-club", "text-club-foreground");
    fireEvent.click(save);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Exit without saving" }));
    expect(onExitWithoutSave).toHaveBeenCalledTimes(1);
  });
});
