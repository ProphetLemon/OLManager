import { useTranslation } from "react-i18next";

import { formatClock } from "@/lib/match/live/clock";
import { barChart, goldAtMinute, type Scoreboard } from "@/lib/match/live/postGame";
import type { TimelineEntry } from "@/lib/match/live/postGameTimeline";
import type { MatchRecord } from "@/lib/match/live/matchRecord";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";

import { BarChartPanel } from "./BarChartPanel";
import { GoldDiffChart } from "./GoldDiffChart";
import "./postGame.css";

/** The minutes at which a player's gold is read off the record, as the table's extra columns. */
const GOLD_AT_MINUTES = [10, 20] as const;

export interface PostGameGraphsProps {
  board: Scoreboard;
  record: MatchRecord | undefined;
  entries: TimelineEntry[];
  blue: TeamIdentity;
  red: TeamIdentity;
  championByPlayerId: Record<string, string>;
}

/**
 * The team gold difference with the objectives marked on it, then damage to champions and gold
 * earned for each player. Every chart has a text alternative and a table. A chart whose numbers the
 * engine did not send is not drawn: damage says so in one line, and nothing is shown as zero.
 */
export function PostGameGraphs({ board, record, entries, blue, red, championByPlayerId }: PostGameGraphsProps) {
  const { t } = useTranslation();
  const damage = barChart(board, "damage");
  const gold = barChart(board, "gold");
  return (
    <div className="pg-graphs" data-testid="post-game-graphs">
      <GoldDiffChart record={record} durationSec={board.durationSec} entries={entries} blue={blue} red={red} />
      <div className="pg-pair">
        {damage ? (
          <BarChartPanel id="damage" title={t("onAir.match.post.damageTitle")} chart={damage} blue={blue} red={red} championByPlayerId={championByPlayerId} />
        ) : (
          <section className="pg-panel" aria-labelledby="pg-damage-title">
            <div className="pg-panel-head">
              <h3 id="pg-damage-title">{t("onAir.match.post.damageTitle")}</h3>
            </div>
            <p className="pg-note">{t("onAir.match.post.damageNone")}</p>
          </section>
        )}
        {gold ? (
          <BarChartPanel
            id="gold"
            title={t("match.draftResult.columns.goldEarned")}
            chart={gold}
            blue={blue}
            red={red}
            championByPlayerId={championByPlayerId}
            extraColumns={GOLD_AT_MINUTES.map((minute) => ({
              id: `at-${minute}`,
              heading: t("onAir.match.post.goldAt", { time: formatClock(minute * 60) }),
              value: (playerId: string) => goldAtMinute(record, playerId, minute),
            }))}
          />
        ) : null}
      </div>
    </div>
  );
}
