import { useEffect, useRef } from "react";
import { Check, Landmark, MapPin, Plus, Star, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TeamSummary } from "@/store/gameStore";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";
import { formatFinance, getReputationLabel, getTeamLogoPath } from "@/ui-v2/_legacy/components/teamSelection/teamSelection.helpers";
import { useRovingFocus } from "@/hooks/useRovingFocus";

interface TeamGridV2Props {
  teams: TeamSummary[];
  onSelectTeam: (id: string) => void;
  selectedTeamId: string | null;
  /** When set, a dashed "create your team" card is rendered before the teams. */
  onCreateTeam?: () => void;
}

export function TeamGridV2({
  teams, onSelectTeam, selectedTeamId, onCreateTeam,
}: TeamGridV2Props) {
  const { t } = useTranslation();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The create card, when present, is roving-focus item 0; teams follow it.
  const offset = onCreateTeam ? 1 : 0;
  const createLabel = t("teamSelect.custom.create");
  const { activeIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: teams.length + offset,
    columns: 2,
    loop: false,
    onSelect: (i) => {
      if (offset && i === 0) onCreateTeam?.();
      else onSelectTeam(teams[i - offset]?.id);
    },
    getItemLabel: (i) => (offset && i === 0 ? createLabel : teams[i - offset]?.name ?? ""),
  });

  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  return (
    <div
      className="flex-1 overflow-y-auto p-6 md:p-8 scrollbar-v2"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-2">
          {onCreateTeam && (
            <button type="button"
              ref={(el) => { itemRefs.current[0] = el; }}
              tabIndex={getTabIndex(0)}
              onClick={onCreateTeam}
              className="group flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-5 text-center transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                <Plus className="size-6" aria-hidden="true" />
              </span>
              <span className="font-heading text-base font-bold uppercase tracking-wide text-foreground">{createLabel}</span>
              <span className="max-w-xs text-xs text-muted-foreground">
                {t("teamSelect.custom.createHint")}
              </span>
            </button>
          )}
          {teams.map((team, idx) => {
            const i = idx + offset;
            const isSelected = team.id === selectedTeamId;
            const rep = getReputationLabel(team.reputation ?? 0);
            const logo = getTeamLogoPath(team.id, team.logo_url);

            return (
              <button key={team.id} type="button"
                ref={(el) => { itemRefs.current[i] = el; }}
                tabIndex={getTabIndex(i)}
                onClick={() => onSelectTeam(team.id)}
                className={cn(
                    "group relative overflow-hidden rounded-xl border-2 p-5 text-left transition-all duration-300 animate-fade-in-up",
                  isSelected
                    ? "border-primary bg-gradient-to-br from-primary/10 to-primary/5 shadow-xl shadow-primary/10"
                    : "border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
                )}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {isSelected && (
                  <div className="absolute -right-10 -top-10 size-28 rounded-full bg-primary/20 blur-3xl" />
                )}

                <div className="relative z-10">
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      "flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 transition-all duration-300",
                      isSelected ? "border-primary/40 bg-primary/10" : "border-border bg-muted group-hover:border-primary/30",
                    )}>
                      {logo && <img src={logo} alt={team.name} className="size-11 object-contain transition-transform duration-300 group-hover:scale-110" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="truncate font-heading text-base font-bold uppercase tracking-wide text-foreground">
                          {team.name}
                        </h3>
                        {isSelected && (
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary">
                            <Check className="size-3 text-primary-foreground" />
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <MapPin className="size-3" />
                        {team.short_name} · {team.country}
                      </p>
                    </div>

                    {team.ovr != null && (
                      <div className={cn(
                        "shrink-0 rounded-lg px-3 py-2 text-center transition-all",
                        isSelected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary group-hover:bg-primary/20",
                      )}>
                        <p className={cn("font-heading text-xl font-black tabular-nums", isSelected && "text-primary-foreground")}>{team.ovr}</p>
                        <p className={cn("text-[10px] font-bold uppercase tracking-wider", isSelected ? "text-primary-foreground/70" : "text-primary/60")}>OVR</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-center transition-colors group-hover:bg-muted/50">
                      <Users className="mx-auto mb-0.5 size-4 text-muted-foreground" />
                      <p className="font-heading text-sm font-bold tabular-nums text-foreground">{team.player_count ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground">Players</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-center transition-colors group-hover:bg-muted/50">
                      <Star className="mx-auto mb-0.5 size-4 text-muted-foreground" />
                      <p className="font-heading text-sm font-bold text-foreground">{team.short_name}</p>
                      <p className="text-[10px] text-muted-foreground">Tag</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-center transition-colors group-hover:bg-muted/50">
                      <Landmark className="mx-auto mb-0.5 size-4 text-muted-foreground" />
                      <p className="font-heading text-sm font-bold tabular-nums text-emerald-400">{formatFinance(team.finance ?? 0)}</p>
                      <p className="text-[10px] text-muted-foreground">Budget</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={rep.variant} className="text-[10px]">{rep.label}</Badge>
                      <span className="text-[10px] text-muted-foreground/60">Rep: {team.reputation}</span>
                    </div>
                    {team.colors?.primary && team.colors.primary !== "#000000" && (
                      <span className="size-3 rounded-full border border-border" style={{ backgroundColor: team.colors.primary }} />
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
  );
}
