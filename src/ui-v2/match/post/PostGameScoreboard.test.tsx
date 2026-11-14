import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { buildScoreboard } from "@/lib/match/live/postGame";
import { champions, finishedMatch, matchRecord } from "@/lib/match/live/postGameFixtures.testing";
import { teamIdentity } from "@/lib/match/live/teamIdentity";

import { PostGameScoreboard } from "./PostGameScoreboard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const BLUE = { ...teamIdentity("Shifters", [{ name: "Shifters", short_name: "SHI" }]), logoUrl: "/teams-icons/shifters.webp" };
const RED = teamIdentity("Movistar KOI", [{ name: "Movistar KOI", short_name: "MKOI" }]);
const PICKS = { "b-adc": "Jinx", "b-top": "Renekton", "r-adc": "Kaisa" };
const NAMES = { black_cleaver: "Black Cleaver", stealth_ward: "Stealth Ward", oracle_lens: "Oracle Lens" };

function show(over: Parameters<typeof finishedMatch>[0] = {}) {
  const board = buildScoreboard(finishedMatch(over));
  return render(<PostGameScoreboard board={board} blue={BLUE} red={RED} championByPlayerId={PICKS} itemNames={NAMES} />);
}

const tableOf = (name: string) => screen.getByRole("table", { name });

describe("PostGameScoreboard", () => {
  it("shows one table for each team with its five players and a team total", () => {
    show();
    const blue = tableOf("Shifters players");
    const rows = within(blue).getAllByRole("row");
    // The header row, five players and the total.
    expect(rows).toHaveLength(7);
    expect(within(tableOf("Movistar KOI players")).getAllByRole("row")).toHaveLength(7);
  });

  it("gives both teams the same column widths, so the two tables line up", () => {
    show();
    const widths = (name: string) => [...tableOf(name).querySelectorAll("colgroup col")].map((col) => col.getAttribute("data-col"));
    const blue = widths("Shifters players");
    expect(blue.length).toBeGreaterThan(3);
    expect(widths("Movistar KOI players")).toEqual(blue);
    expect(blue[0]).toBe("player");
    // One <col> for every header cell of the table.
    expect(blue).toHaveLength(tableOf("Shifters players").querySelectorAll("thead th").length);
  });

  it("gives each team a result badge and its logo and tag, in the side's shape", () => {
    show();
    const blue = tableOf("Shifters players");
    expect(within(blue).getByText("Victory")).toHaveAttribute("data-result", "win");
    expect(within(blue).getByText("SHI")).toBeInTheDocument();
    expect(blue.querySelector(".arena-crest img")).toHaveAttribute("src", "/teams-icons/shifters.webp");
    const red = tableOf("Movistar KOI players");
    expect(within(red).getByText("Defeat")).toHaveAttribute("data-result", "loss");
    expect(red.querySelector(".arena-crest")).toHaveAttribute("data-team", "red");
  });

  it("writes each player's level, K/D/A, CS, gold earned and damage in the player's row", () => {
    show();
    const row = within(tableOf("Shifters players")).getByRole("row", { name: /Paduck/ });
    expect(within(row).getByText("Paduck")).toBeInTheDocument();
    expect(within(row).getByText(/Jinx/)).toBeInTheDocument();
    expect(within(row).getByText("18")).toBeInTheDocument();
    expect(within(row).getByText("7/2/8")).toBeInTheDocument();
    expect(within(row).getByText("301")).toBeInTheDocument();
    expect(within(row).getByText("24.6k")).toBeInTheDocument();
    expect(within(row).getByText("34.7k")).toBeInTheDocument();
  });

  it("names the items, the trinket and the spells for a screen reader, and shows their icons", () => {
    show();
    const row = within(tableOf("Shifters players")).getByRole("row", { name: /Rooster/ });
    expect(within(row).getByRole("group", { name: "Items: Black Cleaver, Plated Steelcaps, Sunfire Aegis. Stealth Ward" })).toBeInTheDocument();
    expect(within(row).getByRole("group", { name: "Flash, Teleport" })).toBeInTheDocument();
    const images = [...row.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(images).toContain("/lol-item-icons/black_cleaver.png");
    expect(images).toContain("/lol-item-icons/stealth_ward.png");
    expect(images).toContain("/lol-summoner-icons/SummonerFlash.png");
    // Six item slots, empty ones drawn as empty boxes, plus the trinket.
    expect(row.querySelectorAll(".pg-icon[data-shape='item']")).toHaveLength(6);
  });

  it("marks only the winning team's best player as MVP", () => {
    show();
    const mvps = screen.getAllByText("MVP");
    expect(mvps).toHaveLength(1);
    expect(within(tableOf("Shifters players")).getByRole("row", { name: /Paduck/ })).toContainElement(mvps[0]);
  });

  it("totals each team and counts its objectives, heralds included for a match watched whole", () => {
    show();
    const blue = tableOf("Shifters players");
    const total = within(blue).getAllByRole("row")[6];
    expect(within(total).getByText("21/11/51")).toBeInTheDocument();
    expect(within(total).getByText("98.7k")).toBeInTheDocument();
    expect(within(total).getByRole("img", { name: "Towers: 7" })).toBeInTheDocument();
    expect(within(total).getByRole("img", { name: "Dragons: 4" })).toBeInTheDocument();
    expect(within(total).getByRole("img", { name: "Barons: 1" })).toBeInTheDocument();
    expect(within(tableOf("Movistar KOI players")).getByRole("img", { name: "Herald: 1" })).toBeInTheDocument();
  });

  it("leaves the herald count out for a skipped match instead of writing a zero", () => {
    show({ matchRecord: matchRecord({ skippedAtSec: 600 }) });
    expect(screen.queryByRole("img", { name: /Herald/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /^Towers: / })).toHaveLength(2);
  });

  it("leaves the damage column out when the engine did not send damage", () => {
    show({ champions: champions({ damageDealt: undefined }) });
    expect(screen.queryByRole("columnheader", { name: "Damage" })).not.toBeInTheDocument();
    expect(screen.queryByText("34.7k")).not.toBeInTheDocument();
    // The rest of the row is still there.
    expect(screen.getAllByText("7/2/8").length).toBeGreaterThan(0);
  });
});
