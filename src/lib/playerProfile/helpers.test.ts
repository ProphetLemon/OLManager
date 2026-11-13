import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";

import type { PlayerData, TeamData } from "@/store/gameStore";
import {
    formatPlayerMarketValue,
    formatPlayerWage,
    getAttributeColorClass,
    getPlayerAge,
    getPlayerTeamName,
} from "@/lib/playerProfile/helpers";

function createTeam(overrides: Partial<TeamData> = {}): TeamData {
    return {
        id: "team-1",
        name: "Alpha FC",
        short_name: "ALP",
        country: "GB",
        city: "London",
        stadium_name: "Alpha Ground",
        stadium_capacity: 30000,
        finance: 500000,
        manager_id: "manager-1",
        reputation: 50,
        wage_budget: 50000,
        transfer_budget: 250000,
        season_income: 0,
        season_expenses: 0,
        draft_strategy: "Balanced",
        training_focus: "General",
        training_intensity: "Balanced",
        training_schedule: "Balanced",
        founded_year: 1900,
        colors: { primary: "#000000", secondary: "#ffffff" },
        starting_xi_ids: [],
        form: [],
        history: [],
        ...overrides,
    };
}

function createPlayer(overrides: Partial<PlayerData> = {}): PlayerData {
    return {
        id: "player-1",
        match_name: "J. Smith",
        full_name: "John Smith",
        date_of_birth: "2000-01-01",
        nationality: "GB",
        position: "Forward",
        natural_position: "Forward",
        alternate_positions: [],
        training_focus: null,
        attributes: {
            pace: 60,
            stamina: 60,
            strength: 60,
            agility: 60,
            passing: 60,
            shooting: 60,
            tackling: 60,
            dribbling: 60,
            defending: 60,
            positioning: 60,
            vision: 60,
            decisions: 60,
            composure: 60,
            aggression: 60,
            teamwork: 60,
            leadership: 60,
            handling: 20,
            reflexes: 20,
            aerial: 60,
        },
        condition: 80,
        morale: 75,
        team_id: "team-1",
        contract_end: "2026-10-15",
        wage: 12000,
        market_value: 350000,
        stats: {
            appearances: 10,
            goals: 4,
            assists: 3,
            clean_sheets: 0,
            yellow_cards: 1,
            red_cards: 0,
            avg_rating: 7.2,
            minutes_played: 450,
            shots: 20,
            shots_on_target: 10,
            passes_completed: 80,
            passes_attempted: 100,
            tackles_won: 9,
            interceptions: 6,
            fouls_committed: 5,
        },
        career: [],
        transfer_listed: false,
        loan_listed: false,
        transfer_offers: [],
        traits: [],
        ...overrides,
    };
}

void createPlayer;

describe("playerProfile helpers", function (): void {
    it("resolves the player team name with free-agent and unknown fallbacks", function (): void {
        const teams = [createTeam()];

        expect(
            getPlayerTeamName(teams, "team-1", {
                freeAgent: "Free Agent",
                unknown: "Unknown",
            }),
        ).toBe("Alpha FC");
        expect(
            getPlayerTeamName(teams, null, {
                freeAgent: "Free Agent",
                unknown: "Unknown",
            }),
        ).toBe("Free Agent");
        expect(
            getPlayerTeamName(teams, "team-2", {
                freeAgent: "Free Agent",
                unknown: "Unknown",
            }),
        ).toBe("Unknown");
    });

    it("calculates age relative to an as-of date instead of just the birth year", function (): void {
        expect(getPlayerAge("2000-07-02", "2026-07-01")).toBe(25);
        expect(getPlayerAge("2000-07-01", "2026-07-01")).toBe(26);
    });

    it("formats market values across value ranges", function (): void {
        expect(formatPlayerMarketValue(999)).toBe("€999");
        expect(formatPlayerMarketValue(125000)).toBe("€125K");
        expect(formatPlayerMarketValue(2500000)).toBe("€2.5M");
    });

    it("formats annual wages with annual suffix", function (): void {
        expect(formatPlayerWage(52000, "/año")).toMatch(/^€52[.,]000\/año$/);
    });

    it("maps attribute values to the expected color classes", function (): void {
        expect(getAttributeColorClass(85)).toContain("text-primary-500");
        expect(getAttributeColorClass(65)).toContain("text-accent-600");
        expect(getAttributeColorClass(45)).toContain("text-gray-600");
        expect(getAttributeColorClass(20)).toContain("text-red-500");
    });

});

describe("formatPlayerMarketValue in the game language", () => {
    afterEach(async () => {
        await i18n.changeLanguage("en");
    });

    it.each([
        ["es", "€1,5M"],
        ["en", "€1.5M"],
    ])("writes millions in %s", async (language, expected) => {
        await i18n.changeLanguage(language);
        expect(formatPlayerMarketValue(1_500_000)).toBe(expected);
    });
});
