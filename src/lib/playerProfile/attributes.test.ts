import { describe, expect, it } from "vitest";
import type { PlayerData, ScoutReportData } from "@/store/gameStore";
import { buildPlayerAttributeGroups } from "@/lib/playerProfile/attributes";

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
            stamina: 61,
            strength: 62,
            agility: 63,
            passing: 64,
            shooting: 65,
            tackling: 66,
            dribbling: 67,
            defending: 68,
            positioning: 69,
            vision: 70,
            decisions: 71,
            composure: 72,
            aggression: 73,
            teamwork: 74,
            leadership: 75,
            handling: 76,
            reflexes: 77,
            aerial: 78,
        },
        condition: 80,
        morale: 75,
        team_id: "team-1",
        contract_end: "2026-10-15",
        wage: 12000,
        market_value: 350000,
        stats: {
            appearances: 0,
            goals: 0,
            assists: 0,
            clean_sheets: 0,
            yellow_cards: 0,
            red_cards: 0,
            avg_rating: 0,
            minutes_played: 0,
        },
        career: [],
        transfer_listed: false,
        loan_listed: false,
        transfer_offers: [],
        traits: [],
        ...overrides,
    };
}

describe("playerProfile attributes", () => {
    const t = (key: string): string => key;

    it("builds the LoL-facing attribute groups with averages", () => {
        const groups = buildPlayerAttributeGroups(createPlayer(), t);

        expect(groups.map((group) => group.label)).toEqual([
            "playerProfile.lolStatGroups.gameplay",
            "playerProfile.lolStatGroups.gameIq",
            "playerProfile.lolStatGroups.competitive",
        ]);
        expect(groups[0]?.attrs.map((attr) => attr.name)).toEqual([
            "playerProfile.lolStats.mechanics",
            "playerProfile.lolStats.laning",
            "playerProfile.lolStats.teamfighting",
        ]);
        expect(groups[0]?.average).toBe(69);
        expect(groups[1]?.attrs.map((attr) => attr.name)).toEqual([
            "playerProfile.lolStats.macro",
            "playerProfile.lolStats.consistency",
            "playerProfile.lolStats.shotcalling",
        ]);
        expect(groups[1]?.average).toBe(72);
        expect(groups[2]?.attrs.map((attr) => attr.name)).toEqual([
            "playerProfile.lolStats.championPool",
            "playerProfile.lolStats.discipline",
            "playerProfile.lolStats.mentalResilience",
        ]);
        expect(groups[2]?.average).toBe(65);
    });

    it("builds partial attribute groups from discovered scout report values", () => {
        const report: ScoutReportData = {
            player_id: "player-1",
            player_name: "J. Smith",
            position: "ADC",
            nationality: "GB",
            dob: "2000-01-01",
            team_name: "Beta FC",
            pace: null,
            shooting: null,
            passing: null,
            dribbling: null,
            defending: null,
            physical: null,
            mechanics: 81,
            laning: null,
            teamfighting: 77,
            macro: 73,
            champion_pool: null,
            discipline: 69,
            condition: null,
            morale: null,
            avg_rating: 75,
            rating_key: "common.scoutRatings.veryGood",
            potential_key: "common.scoutPotential.strong",
            confidence_key: "common.scoutConfidence.moderate",
        };

        const groups = buildPlayerAttributeGroups(createPlayer(), t, report);

        expect(groups[0]?.attrs.map((attr) => attr.value)).toEqual([81, null, 77]);
        expect(groups[0]?.average).toBe(79);
        expect(groups[1]?.attrs.map((attr) => attr.value)).toEqual([73, null, null]);
        expect(groups[2]?.attrs.map((attr) => attr.value)).toEqual([null, 69, null]);
    });

    it("hides every attribute when an outside player has no scout report", () => {
        const groups = buildPlayerAttributeGroups(createPlayer(), t, null);

        expect(groups.flatMap((group) => group.attrs).map((attr) => attr.value)).toEqual([
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
        ]);
        expect(groups.map((group) => group.average)).toEqual([null, null, null]);
    });
});
