import type { FixtureData, LeagueData, TeamData } from "@/store/gameStore";
import { useTranslation } from "react-i18next";

interface PlayoffBracketBoardProps {
  league: LeagueData;
  teams: TeamData[];
  onSelectTeam?: (teamId: string) => void;
  title?: string;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type PlayoffSplit = "winter" | "spring" | "summer" | "unknown" | "fourTeam";

// Mirrors schedule::FOUR_TEAM_PLAYOFF_ID_PREFIX in olm_core: the backend marks
// four-team single-elimination fixtures with this id prefix.
const FOUR_TEAM_PLAYOFF_ID_PREFIX = "po4-";

function isFourTeamBracket(playoffFixtures: FixtureData[]): boolean {
  return playoffFixtures.every((fixture) => fixture.id.startsWith(FOUR_TEAM_PLAYOFF_ID_PREFIX));
}

function resolvePlayoffSplit(leagueName: string): Exclude<PlayoffSplit, "fourTeam"> {
  const key = normalizeKey(leagueName);
  if (key.includes("winter")) return "winter";
  if (key.includes("spring")) return "spring";
  if (key.includes("summer")) return "summer";
  return "unknown";
}

function playoffRoundLabel(split: PlayoffSplit, roundIndex: number): string {
  if (split === "winter") {
    const labels = [
      "UPPER R1",
      "LOWER R1",
      "UPPER R2",
      "LOWER R2",
      "UPPER FINAL",
      "LOWER R3",
      "LOWER FINAL",
      "SPLIT FINAL",
    ];
    return labels[roundIndex] ?? `ROUND ${roundIndex + 1}`;
  }

  if (split === "spring" || split === "summer") {
    const labels = [
      "UPPER R1",
      "LOWER R1",
      "UPPER FINAL",
      "LOWER R2",
      "LOWER FINAL",
      "SPLIT FINAL",
    ];
    return labels[roundIndex] ?? `ROUND ${roundIndex + 1}`;
  }

  return `ROUND ${roundIndex + 1}`;
}

function laneForRound(split: PlayoffSplit, roundIndex: number): "upper" | "lower" {
  if (split === "winter") {
    return [0, 2, 4, 7].includes(roundIndex) ? "upper" : "lower";
  }
  if (split === "spring" || split === "summer") {
    return [0, 2, 5].includes(roundIndex) ? "upper" : "lower";
  }
  return "upper";
}

function toScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function fixtureScore(fixture: FixtureData): { home: number; away: number } | null {
  if (!fixture.result) return null;
  const home = toScore(fixture.result.home_wins ?? fixture.result.home_goals);
  const away = toScore(fixture.result.away_wins ?? fixture.result.away_goals);
  return { home, away };
}

function fixtureWinnerTeamId(fixture: FixtureData): string | null {
  const score = fixtureScore(fixture);
  if (!score) return null;
  if (score.home === score.away) return null;
  return score.home > score.away ? fixture.home_team_id : fixture.away_team_id;
}

function getTeamName(teams: TeamData[], teamId: string): string {
  return teams.find((team) => team.id === teamId)?.name ?? teamId;
}

export default function PlayoffBracketBoard({
  league,
  teams,
  onSelectTeam,
  title,
}: PlayoffBracketBoardProps) {
  const { t } = useTranslation();
  const playoffFixtures = league.fixtures.filter((fixture) => fixture.match_type === "Playoffs");
  if (playoffFixtures.length === 0) {
    return null;
  }

  const split: PlayoffSplit = isFourTeamBracket(playoffFixtures)
    ? "fourTeam"
    : resolvePlayoffSplit(league.name);
  const rounds = Array.from(
    playoffFixtures.reduce((map, fixture) => {
      const list = map.get(fixture.matchday) ?? [];
      list.push(fixture);
      map.set(fixture.matchday, list);
      return map;
    }, new Map<number, FixtureData[]>()),
  ).sort((left, right) => left[0] - right[0]);

  const upperRounds = rounds.filter((_, index) => laneForRound(split, index) === "upper");
  const lowerRounds = rounds.filter((_, index) => laneForRound(split, index) === "lower");
  const fixtureOrder = new Map<string, number>();
  let fixtureCounter = 1;
  rounds.forEach(([, fixtures]) => {
    fixtures.forEach((fixture) => {
      fixtureOrder.set(fixture.id, fixtureCounter);
      fixtureCounter += 1;
    });
  });

  const renderRound = ([matchday, fixtures]: [number, FixtureData[]], indexInLane: number, roundIndex: number) => (
    <div key={`round-${matchday}`} className="relative min-w-56">
      {indexInLane > 0 ? (
        <div className="hidden lg:block absolute -left-6 top-1/2 w-6 h-px bg-cyan-300/40" />
      ) : null}
      <div className="rounded-xl border border-cyan-300/20 bg-navy-900/60 p-3">
        <p className="text-xs font-heading font-bold uppercase tracking-[0.18em] text-cyan-200/90">
          {split === "fourTeam"
            ? roundIndex === 0
              ? t("tournaments.playoffSemifinals")
              : t("tournaments.playoffFinal")
            : playoffRoundLabel(split, roundIndex)}
        </p>
        <div className="mt-2 space-y-2">
          {fixtures.map((fixture) => {
            const winner = fixtureWinnerTeamId(fixture);
            const score = fixtureScore(fixture);
            const bestOf = fixture.best_of ?? 3;
            const matchNumber = fixtureOrder.get(fixture.id) ?? 0;
            return (
              <div key={fixture.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <p className="text-2xs font-heading font-bold uppercase tracking-wider text-cyan-300/85 mb-1">
                  M{matchNumber} · BO{bestOf}
                </p>

                <button
                  type="button"
                  className={`w-full text-left text-sm font-heading uppercase tracking-wide ${winner === fixture.home_team_id ? "text-accent-400 font-bold" : "text-gray-100"}`}
                  onClick={() => onSelectTeam?.(fixture.home_team_id)}
                >
                  {getTeamName(teams, fixture.home_team_id)}
                </button>
                <button
                  type="button"
                  className={`w-full text-left text-sm font-heading uppercase tracking-wide mt-0.5 ${winner === fixture.away_team_id ? "text-accent-400 font-bold" : "text-gray-100"}`}
                  onClick={() => onSelectTeam?.(fixture.away_team_id)}
                >
                  {getTeamName(teams, fixture.away_team_id)}
                </button>

                <p className="mt-1.5 text-xs text-gray-400 font-heading uppercase tracking-wider">
                  {score ? `${score.home} - ${score.away}` : t("tournaments.scheduled")}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <section className="rounded-2xl border border-cyan-300/20 bg-[radial-gradient(circle_at_20%_20%,rgba(22,163,255,0.18),transparent_55%),radial-gradient(circle_at_80%_80%,rgba(15,23,42,0.8),transparent_55%),linear-gradient(145deg,#061235_0%,#03081f_65%,#020617_100%)] p-4 md:p-5">
      <p className="text-xs md:text-sm font-heading font-bold uppercase tracking-[0.28em] text-cyan-100/90 mb-4">
        {title ?? t("tournaments.playoffBracketTitle")}
      </p>

      <div className="space-y-5">
        <div>
          <p className="text-xs font-heading font-bold uppercase tracking-[0.2em] text-cyan-300/90 mb-2">{split === "fourTeam" ? t("tournaments.singleEliminationBracket") : t("tournaments.upperBracket")}</p>
          <div className="flex gap-3 overflow-x-auto pb-2">{upperRounds.map((round, i) => renderRound(round, i, rounds.indexOf(round)))}</div>
        </div>

        {lowerRounds.length > 0 ? (
          <div>
            <p className="text-xs font-heading font-bold uppercase tracking-[0.2em] text-cyan-300/90 mb-2">{t("tournaments.lowerBracket")}</p>
            <div className="flex gap-3 overflow-x-auto pb-1">{lowerRounds.map((round, i) => renderRound(round, i, rounds.indexOf(round)))}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
