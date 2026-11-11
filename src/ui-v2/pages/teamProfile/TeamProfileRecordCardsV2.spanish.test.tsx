import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { TeamProfileRecentMatchesCardV2 } from "./TeamProfileRecordCardsV2";

const MATCHES = [
  {
    fixtureId: "f1", date: "2026-08-01", competition: "lec", matchday: 1,
    opponentTeamId: "t2", opponentName: "Bravo FC", side: "Blue", result: "Loss",
    gameDurationSeconds: 1800, kills: 10, deaths: 2, goldEarned: 100, damageToChampions: 200, objectives: 5,
  },
  {
    fixtureId: "f2", date: "2026-08-08", competition: "lec", matchday: 2,
    opponentTeamId: "t3", opponentName: "Charlie FC", side: "Red", result: "Win",
    gameDurationSeconds: 1900, kills: 12, deaths: 4, goldEarned: 120, damageToChampions: 220, objectives: 6,
  },
] as const;

beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("TeamProfileRecentMatchesCardV2 in the Spanish UI", () => {
  it("writes the column labels, the side and the result in Spanish", () => {
    const { container } = render(<TeamProfileRecentMatchesCardV2 matches={[...MATCHES] as never} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Partidos recientes");
    expect(text).toContain("Lado");
    expect(text).toContain("Oro / Daño");
    expect(text).toContain("Lado azul · Derrota");
    expect(text).toContain("Lado rojo · Victoria");
    for (const english of [/\bSide\b/, /Blue/, /Red\b/, /\bLoss\b/, /\bWin\b/, /Gold \/ Objectives/]) {
      expect(text, String(english)).not.toMatch(english);
    }
  });

  it("groups the gold with the locale separator and shows a dash where no damage was recorded", () => {
    const matches = [
      { ...MATCHES[0], goldEarned: 40426, damageToChampions: 0 },
      { ...MATCHES[1], goldEarned: 63125, damageToChampions: 123456 },
    ];
    const { container } = render(<TeamProfileRecentMatchesCardV2 matches={matches as never} />);
    const text = container.textContent ?? "";

    expect(text).toContain("40.426 / —");
    expect(text).toContain("63.125 / 123.456");
    expect(text).not.toContain("40426");
    expect(text).not.toMatch(/\/ 0(?!\d)/);
  });
});
