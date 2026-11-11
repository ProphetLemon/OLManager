import type { TeamData } from "../../store/gameStore";

export interface TeamNameLabels {
    freeAgent?: string;
    unknown?: string;
}

/**
 * Name of a team. The two fallbacks are shown to the player when the id is empty or not in the
 * list: screens pass their translated labels, the English defaults serve sorting and searching.
 */
export function getTeamName(
    teams: TeamData[],
    id: string | null,
    labels: TeamNameLabels = {},
): string {
    if (!id) {
        return labels.freeAgent ?? "Free Agent";
    }
    return teams.find((team) => team.id === id)?.name ?? labels.unknown ?? "Unknown";
}

export function getTeamShort(teams: TeamData[], id: string): string {
    return teams.find((team) => team.id === id)?.short_name ?? "???";
}

