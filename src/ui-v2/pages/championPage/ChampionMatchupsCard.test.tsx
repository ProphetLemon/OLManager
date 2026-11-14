import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getChampionMatchups } from "@/lib/champions/championMatchups";
import { championDisplayName } from "@/lib/champions/championNames";
import ChampionMatchupsCard from "./ChampionMatchupsCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { value?: number }) =>
      ({
        "championPage.counterTitle": "Counter matchups",
        "championPage.counterStrong": "Strong against",
        "championPage.counterWeak": "Weak against",
        "championPage.counterEmpty": "No counter data for this champion.",
        "championPage.noData": "No data available",
        "championPage.counterStrength": `Strength ${options?.value} of 5`,
      })[key] ?? key,
  }),
}));

describe("ChampionMatchupsCard", () => {
  it("renders the strong and weak lists with names and a textual strength", () => {
    render(<ChampionMatchupsCard championKey="Malphite" />);
    const strong = screen.getByRole("region", { name: "Strong against" });
    const weak = screen.getByRole("region", { name: "Weak against" });
    expect(within(strong).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(weak).getAllByRole("listitem").length).toBeGreaterThan(0);
    const [top] = getChampionMatchups("Malphite").strongAgainst;
    expect(within(strong).getByText(championDisplayName(top.championId))).toBeInTheDocument();
    expect(within(strong).getAllByLabelText(/Strength \d of 5/).length).toBeGreaterThan(0);
    expect(screen.queryByText("No counter data for this champion.")).not.toBeInTheDocument();
  });

  it("shows the empty state when the champion has no counter data", () => {
    render(<ChampionMatchupsCard championKey="notachampion" />);
    expect(screen.getByText("No counter data for this champion.")).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
