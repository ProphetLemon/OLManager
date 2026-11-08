import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CompetitionSummary } from "@/store/gameStore";
import { LeaguePickerV2 } from "@/ui-v2/_legacy/components/teamSelection/LeaguePickerV2";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const competition = (id: string, tier: number): CompetitionSummary => ({
  id,
  name: id.toUpperCase(),
  region: "EU",
  logo: null,
  tier,
  legacy: false,
  active: true,
  team_count: 10,
  teams: [],
});

describe("LeaguePickerV2", () => {
  it("shows regional leagues under their own heading after the main leagues", () => {
    render(<LeaguePickerV2 competitions={[competition("les", 2), competition("lec", 1)]} onSelect={vi.fn()} />);

    const heading = screen.getByRole("heading", { name: "Regional leagues" });
    const main = screen.getByRole("heading", { name: "LEC" });
    const regional = screen.getByRole("heading", { name: "LES" });

    expect(main.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(regional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("omits the regional heading when every league is tier 1", () => {
    render(<LeaguePickerV2 competitions={[competition("lec", 1)]} onSelect={vi.fn()} />);

    expect(screen.queryByRole("heading", { name: "Regional leagues" })).toBeNull();
  });
});
