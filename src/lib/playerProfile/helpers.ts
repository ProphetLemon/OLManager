import type { TeamData } from "../../store/gameStore";
import type {  } from "i18next";
import { calcAge, formatWeeklyAmount } from "../../lib/common/helpers";
import { activeCurrencySymbol, formatNumber } from "@/lib/formatting/valueFormatting";

export function getPlayerTeamName(
    teams: TeamData[],
    teamId: string | null,
    labels: {
        freeAgent: string;
        unknown: string;
    },
): string {
    if (!teamId) {
        return labels.freeAgent;
    }

    return teams.find((team) => team.id === teamId)?.name ?? labels.unknown;
}

export function getPlayerAge(
    dateOfBirth: string,
    asOfDate: string,
): number {
    return calcAge(dateOfBirth, asOfDate);
}

export function formatPlayerMarketValue(value: number): string {
    if (value >= 1_000_000) {
        return `${activeCurrencySymbol()}${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
        return `${activeCurrencySymbol()}${(value / 1_000).toFixed(0)}K`;
    }
    return `${activeCurrencySymbol()}${value}`;
}

export function formatPlayerWage(
    annualWage: number,
    suffix: string,
): string {
    return formatWeeklyAmount(`${activeCurrencySymbol()}${formatNumber(annualWage)}`, suffix);
}

export function getAttributeColorClass(value: number): string {
    if (value >= 80) {
        return "text-primary-500 dark:text-primary-400";
    }
    if (value >= 60) {
        return "text-accent-600 dark:text-accent-400";
    }
    if (value >= 40) {
        return "text-gray-600 dark:text-gray-400";
    }
    return "text-red-500 dark:text-red-400";
}



