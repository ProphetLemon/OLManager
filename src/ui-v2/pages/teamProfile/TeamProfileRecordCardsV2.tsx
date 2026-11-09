import { useTranslation } from "react-i18next";

import { formatWinRate } from "@/lib/teamProfile/clubInfo";
import type { TeamRecentMatchEntry } from "@/lib/teamProfile/types";
import type { TeamData } from "@/store/gameStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui-v2/components/ui/table";

const HEAD = "px-5 font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground";
const TITLE = "font-bold uppercase tracking-wider";

export function TeamProfileRecentMatchesCardV2({ matches }: { matches: TeamRecentMatchEntry[] }) {
  const { t } = useTranslation();
  const label = (key: string, fallback: string) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  if (matches.length === 0) return null;

  const sideLabel = label("teamProfile.side", "Side");
  const scoreLabel = label("teamProfile.kda", "K / D / A");
  const economyLabel = label("teamProfile.economy", "Gold / Objectives");

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle className={TITLE}>{label("teamProfile.recentMatches", "Recent Matches")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {matches.map((match) => (
          <div
            key={match.fixtureId}
            className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-3 rounded-lg bg-muted px-3 py-2.5"
          >
            <div>
              <p className="font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">
                {match.date}
              </p>
              <p className="font-heading text-base font-bold text-foreground">{match.opponentName}</p>
            </div>
            <MatchCell label={sideLabel} value={`${match.side} · ${match.result}`} />
            <MatchCell label={scoreLabel} value={`${match.kills} / ${match.deaths} / ${match.objectives}`} />
            <MatchCell label={economyLabel} value={`${match.goldEarned} / ${match.damageToChampions}`} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MatchCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xs uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <p className="font-heading text-base font-bold tabular-nums text-foreground/90">{value}</p>
    </div>
  );
}

export function TeamProfileHistoryCardV2({ history }: { history: TeamData["history"] }) {
  const { t } = useTranslation();
  if (history.length === 0) return null;

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle className={TITLE}>{t("teamProfile.seasonHistory")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead className={HEAD}>{t("schedule.season", { number: "" })}</TableHead>
              {[
                t("common.position"),
                t("common.played"),
                t("common.won"),
                t("common.lost"),
                t("teamProfile.winRate"),
                `${t("common.won")}-${t("common.lost")}`,
              ].map((heading) => (
                <TableHead key={heading} className={`${HEAD} text-center`}>
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((record) => (
              <TableRow key={record.season}>
                <TableCell className="px-5 font-semibold text-foreground">
                  {record.season}/{record.season + 1}
                </TableCell>
                <TableCell className="px-5 text-center font-heading font-bold text-club-text">
                  #{record.league_position}
                </TableCell>
                {[record.played, record.won, record.lost, formatWinRate(record.won, record.lost), `${record.won}-${record.lost}`].map(
                  (value, index) => (
                    <TableCell
                      key={index}
                      className="px-5 text-center tabular-nums text-muted-foreground/80"
                    >
                      {value}
                    </TableCell>
                  ),
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
