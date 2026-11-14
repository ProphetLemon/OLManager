import { fireEvent, render, screen } from "@testing-library/react";
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

  it("titles a regional card with the short name and puts the long name under it, with no repeat", () => {
    const lckcl = { ...competition("lckcl", 2), name: "LCKCL", region: "LCKCL", full_name: "LCK Challenger League Series" };
    render(<LeaguePickerV2 competitions={[lckcl]} onSelect={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "LCKCL" })).toBeInTheDocument();
    expect(screen.getByText("LCK Challenger League Series")).toBeInTheDocument();
    expect(screen.getAllByText("LCKCL")).toHaveLength(1);
  });

  it("finds a league by its long name, with or without the spaces of the short name", () => {
    const lckcl = { ...competition("lckcl", 2), name: "LCKCL", region: "LCKCL", full_name: "LCK Challenger League Series" };
    const prm = { ...competition("prm", 2), name: "PRM", region: "PRM", full_name: "Techniker Prime League" };
    const search = (text: string) => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
      return screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    };
    render(<LeaguePickerV2 competitions={[lckcl, prm]} onSelect={vi.fn()} />);

    expect(search("Prime")).toEqual(["PRM"]);
    expect(search("Challenger")).toEqual(["LCKCL"]);
    expect(search("LCK CL")).toEqual(["LCKCL"]);
    expect(search("lckcl")).toEqual(["LCKCL"]);
  });
});
