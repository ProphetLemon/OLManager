import type { TeamData } from "@/store/gameStore";
import { Card, CardBody, CardHeader } from "@/ui-v2/_legacy/components/ui";
import type { TeamProfileTranslate } from "@/ui-v2/_legacy/components/teamProfile/TeamProfile.types";

interface TeamProfileHistoryCardProps {
  history: TeamData["history"];
  t: TeamProfileTranslate;
}

export default function TeamProfileHistoryCard({
  history,
  t,
}: TeamProfileHistoryCardProps) {
  if (history.length === 0) {
    return null;
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader>{t("teamProfile.seasonHistory")}</CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted border-b border-border text-xs">
                <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-muted-foreground">
                  {t("schedule.season", { number: "" })}
                </th>
                <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-muted-foreground text-center">
                  {t("common.position")}
                </th>
                <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-muted-foreground text-center">
                  {t("common.played")}
                </th>
                <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-muted-foreground text-center">
                  {t("common.won")}
                </th>
                <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-muted-foreground text-center">
                  {t("common.lost")}
                </th>
                <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-muted-foreground text-center">
                  {t("teamProfile.winRate")}
                </th>
                <th className="py-3 px-5 font-heading font-bold uppercase tracking-wider text-muted-foreground text-center">
                  {`${t("common.won")}-${t("common.lost")}`}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {history.map((record, index) => {
                const decisiveGames = record.won + record.lost;
                const winRate = decisiveGames > 0
                  ? `${Math.round((record.won / decisiveGames) * 100)}%`
                  : "0%";

                return (
                <tr key={index}>
                  <td className="py-3 px-5 font-semibold text-sm text-foreground">
                    {record.season}/{record.season + 1}
                  </td>
                  <td className="py-3 px-5 text-center font-heading font-bold text-sm text-primary">
                    #{record.league_position}
                  </td>
                  <td className="py-3 px-5 text-center text-sm text-muted-foreground/80 tabular-nums">
                    {record.played}
                  </td>
                  <td className="py-3 px-5 text-center text-sm text-muted-foreground/80 tabular-nums">
                    {record.won}
                  </td>
                  <td className="py-3 px-5 text-center text-sm text-muted-foreground/80 tabular-nums">
                    {record.lost}
                  </td>
                  <td className="py-3 px-5 text-center text-sm text-muted-foreground/80 tabular-nums">
                    {winRate}
                  </td>
                  <td className="py-3 px-5 text-center text-sm text-muted-foreground/80 tabular-nums">
                    {record.won}-{record.lost}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

