import i18n from "@/i18n";
import type { GameStateData } from "../store/gameStore";

function userScrimReports(game: GameStateData | null) {
  const teamId = game?.manager?.team_id;
  return (game?.teams ?? []).find((team) => team.id === teamId)?.scrim_reports ?? [];
}

function reportKey(report: { week_key: string; slot_index: number }): string {
  return `${report.week_key}:${report.slot_index}`;
}

/** Keys of the scrim reports the user's club has now; `null` when no game is loaded. */
export function scrimReportKeys(game: GameStateData | null): Set<string> | null {
  return game ? new Set(userScrimReports(game).map(reportKey)) : null;
}

/** One line per scrim report that is not in `before` and has a result: rival and won or lost. */
export function newScrimResultLines(before: Set<string>, game: GameStateData | null): string[] {
  return userScrimReports(game)
    .filter((report) => report.won !== null && !before.has(reportKey(report)))
    .map((report) => {
      const rival = (game?.teams ?? []).find((team) => team.id === report.opponent_team_id)?.name ?? report.opponent_team_id;
      return report.won
        ? i18n.t("dashboard.scrimResultWon", { rival, defaultValue: "Won against {{rival}}" })
        : i18n.t("dashboard.scrimResultLost", { rival, defaultValue: "Lost against {{rival}}" });
    });
}
