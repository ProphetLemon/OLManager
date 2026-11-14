import { render, screen } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { AcademySearchField } from "./AcademySearchField";

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("AcademySearchField", () => {
  it("is named by the full translated sentence, in every language", async () => {
    for (const lng of ["en", "es", "de", "fr", "it", "pt", "pt-BR", "tr"]) {
      await i18n.changeLanguage(lng);
      const { unmount } = render(<AcademySearchField value="" onChange={() => {}} />);
      const expected = i18n.t("youthAcademy.searchPlaceholder");
      expect(screen.getByRole("searchbox", { name: expected }), lng).toHaveAttribute("placeholder", expected);
      unmount();
    }
  });

  it("is wide enough for the longest placeholder instead of the old 10rem box, and narrows only to fit", () => {
    render(<AcademySearchField value="" onChange={() => {}} />);
    const input = screen.getByRole("searchbox");
    expect(input).not.toHaveClass("w-40");
    expect(input).toHaveClass("w-72", "max-w-full");
    // jsdom does not lay the field out: the width is pinned by class and checked in a real window.
  });
});
