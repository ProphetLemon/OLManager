import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import type { TeamSummary } from "@/store/gameStore";
import { TeamGridV2 } from "./TeamGridV2";

const team = { id: "mkoi", name: "Movistar KOI", short_name: "MKOI", country: "ES", reputation: 80, finance: 2500000, player_count: 10, ovr: 71 } as TeamSummary;

beforeAll(async () => {
  await i18n.changeLanguage("es");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("TeamGridV2 team cards", () => {
  it("label the player count, tag, budget and reputation in the language of the UI", () => {
    render(<TeamGridV2 teams={[team]} selectedTeamId={null} onSelectTeam={() => {}} />);
    const card = screen.getByRole("button", { name: /Movistar KOI/ });
    expect(within(card).getByText(i18n.t("teams.colPlayers"))).toBeInTheDocument();
    expect(within(card).getByText(i18n.t("teamSelect.custom.fields.shortName"))).toBeInTheDocument();
    expect(within(card).getByText(i18n.t("finances.budget"))).toBeInTheDocument();
    expect(within(card).getByText(new RegExp(`^${i18n.t("teams.rep")}: 80$`))).toBeInTheDocument();
    // The Spanish words, not the English ones that used to be hard-coded.
    expect(within(card).getByText("Jugadores")).toBeInTheDocument();
    for (const english of ["Players", "Tag", "Budget"]) expect(within(card).queryByText(english)).toBeNull();
  });

  it("follows a language change: German shows Ruf for the reputation", async () => {
    await i18n.changeLanguage("de");
    render(<TeamGridV2 teams={[team]} selectedTeamId={null} onSelectTeam={() => {}} />);
    expect(screen.getByText("Ruf: 80")).toBeInTheDocument();
    await i18n.changeLanguage("es");
  });

  it("joins the tag and the country only when both are present", () => {
    const noCountry = { ...team, id: "bnky", name: "Banky", short_name: "BNK.Y", country: "" } as TeamSummary;
    render(<TeamGridV2 teams={[team, noCountry]} selectedTeamId={null} onSelectTeam={() => {}} />);
    expect(screen.getByText("MKOI · ES")).toBeInTheDocument();
    const card = screen.getByRole("button", { name: /Banky/ });
    const line = card.querySelector("p.flex.items-center.gap-2");
    expect(line?.textContent).toBe("BNK.Y");
  });
});
