import type { BlockerData } from "../services/advanceTimeService";
import type { GameStateData } from "../store/gameStore";

export interface BlockerModal {
    blockers: BlockerData[];
    pendingAction?: () => void;
}

export interface PlayedMatchSummary {
    opponent: string;
    score: string;
}

/** The user's most recent completed fixture, as "<own wins>-<opponent wins>". */
export function latestUserMatchSummary(game: GameStateData): PlayedMatchSummary | null {
    const teamId = game.manager?.team_id;
    if (!teamId) return null;
    let latest: { date: string; home: boolean; fixtureTeams: [string, string]; wins: [number, number] } | null = null;
    for (const league of game.leagues ?? []) {
        for (const fixture of league.fixtures) {
            if (fixture.status !== "Completed" || !fixture.result) continue;
            if (fixture.home_team_id !== teamId && fixture.away_team_id !== teamId) continue;
            if (latest && latest.date >= fixture.date) continue;
            latest = {
                date: fixture.date,
                home: fixture.home_team_id === teamId,
                fixtureTeams: [fixture.home_team_id, fixture.away_team_id],
                wins: [fixture.result.home_wins ?? 0, fixture.result.away_wins ?? 0],
            };
        }
    }
    if (!latest) return null;
    const opponentId = latest.home ? latest.fixtureTeams[1] : latest.fixtureTeams[0];
    const own = latest.home ? latest.wins[0] : latest.wins[1];
    const other = latest.home ? latest.wins[1] : latest.wins[0];
    const opponent = game.teams.find((team) => team.id === opponentId)?.name ?? opponentId;
    return { opponent, score: `${own}-${other}` };
}
