import { useTranslation } from "react-i18next";

import { countryName } from "@/lib/common/countries";
import { calcAge, formatVal } from "@/lib/common/helpers";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";
import { getLolRoleForPlayer } from "@/lib/squad/helpers";
import type { PlayerData } from "@/store/gameStore";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui-v2/components/ui/table";
import { cn } from "@/ui-v2/lib/utils";

const HEAD = "px-5 font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground";

function ConditionBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = clamped >= 70 ? "bg-positive" : clamped >= 40 ? "bg-warning" : "bg-negative";

  return (
    <div className="flex max-w-[100px] items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="min-w-[2.5rem] text-right text-xs font-bold tabular-nums text-muted-foreground">
        {clamped}%
      </span>
    </div>
  );
}

interface TeamProfileRosterCardV2Props {
  roster: PlayerData[];
  currentDate: string;
  isOwnTeam: boolean;
  onSelectPlayer?: (id: string) => void;
}

export default function TeamProfileRosterCardV2({
  roster,
  currentDate,
  isOwnTeam,
  onSelectPlayer,
}: TeamProfileRosterCardV2Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle className="font-bold uppercase tracking-wider">
          {t("teams.squad")} ({roster.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead className="w-14 px-5" />
              <TableHead className={HEAD}>{t("common.position")}</TableHead>
              <TableHead className={HEAD}>{t("common.name")}</TableHead>
              <TableHead className={HEAD}>{t("common.age")}</TableHead>
              <TableHead className={HEAD}>{t("common.nationality")}</TableHead>
              <TableHead className={HEAD}>{t("common.value")}</TableHead>
              {isOwnTeam && <TableHead className={HEAD}>{t("common.condition")}</TableHead>}
              <TableHead className={HEAD}>{t("common.ovr")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roster.map((player) => {
              const ovr = calculateLolOvr(player);
              const lolRole = getLolRoleForPlayer(player);
              const photoUrl = resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url);

              return (
                <TableRow
                  key={player.id}
                  onClick={() => onSelectPlayer?.(player.id)}
                  className="group cursor-pointer"
                >
                  <TableCell className="px-5">
                    {photoUrl ? (
                      <img src={photoUrl} alt={player.match_name} className="size-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex size-8 items-center justify-center rounded-full bg-muted font-heading text-xs font-bold text-muted-foreground">
                        {player.match_name?.charAt(0)?.toUpperCase() ?? "?"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="px-5">
                    <img
                      src={ROLE_ICON_PATHS[lolRole]}
                      alt={lolRole}
                      title={lolRole}
                      className="size-5 object-contain"
                    />
                  </TableCell>
                  <TableCell className="px-5">
                    <span className="font-semibold text-foreground transition-colors group-hover:text-primary">
                      {player.match_name || player.full_name}
                    </span>
                  </TableCell>
                  <TableCell className="px-5 tabular-nums text-muted-foreground/80">
                    {calcAge(player.date_of_birth, currentDate)}
                  </TableCell>
                  <TableCell className="px-5 text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <CountryFlag code={player.nationality} locale={locale} className="text-lg leading-none" />
                      <span>{countryName(player.nationality, locale)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-5 text-muted-foreground/80">{formatVal(player.market_value)}</TableCell>
                  {isOwnTeam && (
                    <TableCell className="px-5">
                      <ConditionBar value={player.condition} />
                    </TableCell>
                  )}
                  <TableCell className="px-5">
                    <span
                      className={cn(
                        "font-heading text-lg font-bold tabular-nums",
                        ovr >= 55 ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {ovr}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
