import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";

import type { PlayerData, ScoutingAssignment, StaffData } from "@/store/gameStore";
import { countryName } from "@/lib/common/countries";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";
import { scoutAssignmentCount, scoutMaxSlots } from "@/lib/scouting/helpers";
import { resolveStaffPhoto } from "@/lib/players/playerPhotos";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";

interface ScoutingScoutDetailsCardV2Props {
  scouts: StaffData[];
  assignments: ScoutingAssignment[];
  players: PlayerData[];
}

export default function ScoutingScoutDetailsCardV2({
  scouts,
  assignments,
  players,
}: ScoutingScoutDetailsCardV2Props) {
  const { t, i18n } = useTranslation();

  if (scouts.length === 0) return null;

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          {t("scouting.yourScouts")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {scouts.map((scout) => {
            const count = scoutAssignmentCount(assignments, scout.id);
            const maxSlots = scoutMaxSlots(scout.attributes.judging_ability);
            const isFull = count >= maxSlots;
            const scoutAssignments = assignments.filter((a) => a.scout_id === scout.id);

            return (
              <div key={scout.id} className="rounded-xl border border-border bg-muted/20 p-3">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10">
                    {resolveStaffPhoto(scout.profile_image_url) ? (
                      <img
                        src={resolveStaffPhoto(scout.profile_image_url)!}
                        alt={`${scout.first_name} ${scout.last_name}`}
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Eye className="size-4 text-club-text" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading text-sm font-bold text-foreground">
                      {scout.first_name} {scout.last_name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground">
                      <CountryFlag code={scout.nationality} locale={i18n.language} className="text-xs leading-none" />
                      <span>{countryName(scout.nationality, i18n.language)}</span>
                    </p>
                  </div>
                  <Badge className={isFull ? "border-warning/30 bg-warning/10 text-warning" : "border-positive/30 bg-positive/10 text-positive"}>
                    {count}/{maxSlots}
                  </Badge>
                </div>

                {/* Judging bars */}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1 font-heading text-2xs uppercase tracking-wider text-muted-foreground">
                      {t("scouting.judgingAbility")}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${scout.attributes.judging_ability}%` }} />
                      </div>
                      <span className="font-heading text-2xs tabular-nums text-muted-foreground">{scout.attributes.judging_ability}</span>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 font-heading text-2xs uppercase tracking-wider text-muted-foreground">
                      {t("scouting.judgingPotential")}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${scout.attributes.judging_potential}%` }} />
                      </div>
                      <span className="font-heading text-2xs tabular-nums text-muted-foreground">{scout.attributes.judging_potential}</span>
                    </div>
                  </div>
                </div>

                {/* Current assignments */}
                {scoutAssignments.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-border pt-2">
                    {scoutAssignments.map((assignment) => {
                      const player = players.find((p) => p.id === assignment.player_id);
                      return player ? (
                        <p key={assignment.id} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{player.full_name}</span>
                          {" · "}{assignment.days_remaining}d
                        </p>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
