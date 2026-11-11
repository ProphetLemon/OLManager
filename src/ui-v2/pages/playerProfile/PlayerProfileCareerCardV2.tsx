import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CareerEntry, GameStateData } from "@/store/gameStore";
import { Button } from "@/ui-v2/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui-v2/components/ui/table";
import { SECTION_TITLE_CLASS } from "./PlayerProfileSectionV2";

interface Props {
  career: CareerEntry[];
  gameState: GameStateData;
  t: (key: string, options?: Record<string, string | number>) => string;
}

const COLLAPSED_ROWS = 3;

export default function PlayerProfileCareerCardV2({ career, gameState, t }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  const sorted = useMemo(
    () => [...career].sort((a, b) => b.season - a.season),
    [career],
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
            {t("playerProfile.career", { defaultValue: "Historial de carrera" })}
          </CardTitle>
          {collapsed ? (
            <ChevronRight className="size-4 text-muted-foreground/70" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground/70" />
          )}
        </button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("competitions.heroSeason")}</TableHead>
              <TableHead>{t("common.team")}</TableHead>
              <TableHead className="text-center">{t("common.appearances", { defaultValue: "PJ" })}</TableHead>
              <TableHead className="text-center">{t("common.kills")}</TableHead>
              <TableHead className="text-center">{t("common.assists")}</TableHead>
              <TableHead className="text-center">{t("common.rating")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((entry, idx) => {
              const team = gameState.teams.find((candidate) => candidate.id === entry.team_id);
              return (
                <TableRow key={`${entry.season}-${entry.team_id}-${idx}`}>
                  <TableCell className="font-heading tabular-nums">{entry.season}</TableCell>
                  <TableCell>{team?.name ?? entry.team_name}</TableCell>
                  <TableCell className="text-center tabular-nums">{entry.appearances}</TableCell>
                  <TableCell className="text-center tabular-nums">{entry.kills}</TableCell>
                  <TableCell className="text-center tabular-nums">{entry.assists}</TableCell>
                  <TableCell className="text-center tabular-nums">
                    <span className="font-heading font-bold">{entry.avg_rating.toFixed(1)}</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

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
