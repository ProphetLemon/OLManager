import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { ResultLetter } from "./ResultLetter";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("ResultLetter", () => {
  it.each([
    ["en", "win", "W", "Win"],
    ["en", "loss", "L", "Loss"],
    ["en", "draw", "D", "Draw"],
    ["es", "win", "V", "Victoria"],
    ["es", "loss", "D", "Derrota"],
    ["es", "draw", "E", "Empate"],
    ["fr", "win", "V", "Victoire"],
    ["fr", "draw", "N", "Nul"],
    ["de", "win", "S", "Sieg"],
    ["de", "loss", "N", "Niederlage"],
    ["it", "loss", "P", "Sconfitta"],
    ["pt", "draw", "E", "Empate"],
    ["pt-BR", "win", "V", "Vitória"],
    ["tr", "win", "G", "Galibiyet"],
    ["tr", "loss", "M", "Mağlubiyet"],
  ] as const)("in %s writes %s as the letter %s with the accessible word %s", async (language, kind, letter, word) => {
    await i18n.changeLanguage(language);
    const { container } = render(<ResultLetter kind={kind} />);

    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent(letter);
    expect(screen.getByText(word)).toHaveClass("sr-only");
  });
});
