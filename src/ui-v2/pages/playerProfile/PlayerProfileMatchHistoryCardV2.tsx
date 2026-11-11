import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Swords } from "lucide-react";
import type { PlayerMatchHistoryEntryData } from "@/store/gameStore";
import { resolveChampionTile } from "@/lib/champions/championImages";
import { formatDateShort } from "@/lib/common/helpers";
import { Button } from "@/ui-v2/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";
import { SECTION_TITLE_CLASS } from "./PlayerProfileSectionV2";

interface Props {
  history: PlayerMatchHistoryEntryData[];
  t: (key: string, options?: Record<string, string | number>) => string;
  language: string;
}

const COLLAPSED_ROWS = 10;

export default function PlayerProfileMatchHistoryCardV2({ history, t, language }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  const sorted = useMemo(
    () => [...history].sort((a, b) => b.date.localeCompare(a.date)),
    [history],
  );

  if (sorted.length === 0) return null;

  const visible = collapsed ? sorted.slice(0, COLLAPSED_ROWS) : sorted;

  return (
    <Card>
      <CardHeader className="space-y-0">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-between"
        >
          <CardTitle className={SECTION_TITLE_CLASS}>
            {t("playerProfile.matchHistory", { defaultValue: "Historial de partidos" })}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground/70">{sorted.length}</span>
            {collapsed ? (
              <ChevronRight className="size-4 text-muted-foreground/70" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground/70" />
            )}
          </div>
        </button>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {visible.map((entry) => {
            const isWin = entry.result === "Win";
            const championTile = entry.championId ? resolveChampionTile(entry.championId) : null;
            return (
              <div
                key={entry.fixtureId}
                className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/30 px-3 py-2"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md font-heading text-xs font-bold tabular-nums",
                    isWin ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative",
                  )}
                >
                  {isWin ? "W" : "L"}
                </span>

                {championTile ? (
                  <img src={championTile} alt="" className="size-7 shrink-0 rounded bg-muted object-cover" />
                ) : (
                  <Swords className="size-5 shrink-0 text-muted-foreground" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">vs {entry.opponentName}</p>
                  <p className="text-caption text-muted-foreground">
                    {entry.championId ? `${entry.championId} · ` : ""}
                    {formatDateShort(entry.date, language)}
                  </p>
                </div>

                <span className="shrink-0 text-xs tabular-nums text-foreground/70">
                  {entry.kills}/{entry.deaths}/{entry.assists}
                </span>
              </div>
            );
          })}
        </div>

        {collapsed && sorted.length > COLLAPSED_ROWS ? (
          <Button
            variant="link"
            size="sm"
            className="mt-3 px-0 font-heading text-xs font-bold uppercase tracking-wider"
            onClick={() => setCollapsed(false)}
          >
            {t("common.showMore", {
              defaultValue: "Ver más ({count})",
              count: sorted.length - COLLAPSED_ROWS,
            })}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
