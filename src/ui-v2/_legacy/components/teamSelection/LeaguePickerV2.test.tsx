import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CompetitionSummary } from "@/store/gameStore";
import { LeaguePickerV2 } from "@/ui-v2/_legacy/components/teamSelection/LeaguePickerV2";

let activeLocale: "en" | "es" = "en";

vi.mock("react-i18next", async () => {
  const { createInstance } = await import("i18next");
  const en = (await import("@/i18n/locales/en.json")).default;
  const es = (await import("@/i18n/locales/es.json")).default;
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  return {
    initReactI18next: { type: "3rdParty", init: vi.fn() },
    useTranslation: () => {
      void i18n.changeLanguage(activeLocale);
      return { i18n, t: i18n.getFixedT(activeLocale) };
    },
  };
});

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

  it("renders the team count with locale plurals", () => {
    const one = { ...competition("lec", 1), team_count: 1 };
    const many = { ...competition("lck", 1), team_count: 8 };
    activeLocale = "en";
    const { unmount } = render(<LeaguePickerV2 competitions={[one, many]} onSelect={vi.fn()} />);
    expect(screen.getByText("1 team")).toBeInTheDocument();
    expect(screen.getByText("8 teams")).toBeInTheDocument();
    unmount();

    activeLocale = "es";
    render(<LeaguePickerV2 competitions={[one, many]} onSelect={vi.fn()} />);
    expect(screen.getByText("1 equipo")).toBeInTheDocument();
    expect(screen.getByText("8 equipos")).toBeInTheDocument();
    expect(screen.queryByText(/Teams/)).toBeNull();
  });
});
