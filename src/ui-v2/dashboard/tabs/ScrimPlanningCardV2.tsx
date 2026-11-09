import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, Swords, WandSparkles, type LucideIcon } from "lucide-react";

import {
  buildTeamLolOvrMap,
  type WeeklyScrimContext,
} from "@/lib/scrims/scrimContext";
import { setWeeklyScrimPlans } from "@/services/trainingService";
import type { GameStateData } from "@/store/gameStore";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";

interface ScrimPlanningCardV2Props {
  gameState: GameStateData;
  weeklyContext: WeeklyScrimContext;
  onGameUpdate?: (state: GameStateData) => void;
  isSaving: boolean;
  setIsSaving: (value: boolean) => void;
  readOnly?: boolean;
}

function teamLogo(teams: GameStateData["teams"], teamId: string): string | null {
  const team = teams.find((t) => t.id === teamId);
  if (!team) return null;
  return resolveTeamLogo(team.short_name ?? team.name, team.logo_url) ??
    resolveTeamLogo(team.name, team.logo_url);
}

export default function ScrimPlanningCardV2({
  gameState,
  weeklyContext,
  onGameUpdate,
  isSaving,
  setIsSaving,
  readOnly = false,
}: ScrimPlanningCardV2Props) {
  const { t } = useTranslation();
  const weekdayLabels = [
    t("training.days.mon"), t("training.days.tue"), t("training.days.wed"),
    t("training.days.thu"), t("training.days.fri"), t("training.days.sat"), t("training.days.sun"),
  ];

  const myTeam = gameState.teams.find((team) => team.id === gameState.manager.team_id);
  if (!myTeam) return null;

  const slots = weeklyContext.capacity;
  const plans = Array.from({ length: slots }, (_, slotIndex) => {
    const merged = weeklyContext.slots[slotIndex]?.plan ?? [];
    return Array.from({ length: 3 }, (_, priorityIndex) => merged[priorityIndex] ?? "");
  });
  const selected = plans.map((plan) => plan[0] ?? "");

  const teamOvrById = useMemo(() => buildTeamLolOvrMap(gameState), [gameState]);

  const options = useMemo(
    () => gameState.teams
      .filter((team) => team.id !== myTeam.id)
      .filter((team) => team.competition_id === myTeam.competition_id)
      .sort((a, b) => (teamOvrById.get(b.id) ?? 0) - (teamOvrById.get(a.id) ?? 0) || a.name.localeCompare(b.name)),
    [gameState.teams, myTeam.id, myTeam.competition_id, teamOvrById],
  );

  const saveWeeklyScrimPlans = async (next: string[][]) => {
    setIsSaving(true);
    try {
      const updated = await setWeeklyScrimPlans(next);
      onGameUpdate?.(updated);
    } catch (error) {
      console.error("Failed to save weekly scrim plans:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const setSlotPlan = (slotIndex: number, priorityIndex: number, teamId: string) => {
    const next = plans.map((plan) => [...plan]);
    next[slotIndex][priorityIndex] = teamId;
    void saveWeeklyScrimPlans(next);
  };

  const streak = myTeam.scrim_loss_streak ?? 0;

  const autofillPlansFromObjective = () => {
    const objective = weeklyContext.objective;
    const byOvrDesc = [...options].sort((a, b) => (teamOvrById.get(b.id) ?? 0) - (teamOvrById.get(a.id) ?? 0));
    const byOvrAsc = [...byOvrDesc].reverse();

    const pool = objective === "Mental"
      ? byOvrAsc
      : objective === "ChampionPool" || objective === "EarlyGame"
        ? [...byOvrDesc.slice(Math.floor(byOvrDesc.length / 3)), ...byOvrDesc.slice(0, Math.floor(byOvrDesc.length / 3))]
        : byOvrDesc;

    if (pool.length === 0) return;

    const next = Array.from({ length: slots }, (_, slotIndex) => {
      const a = pool[slotIndex % pool.length]?.id ?? "";
      const b = pool[(slotIndex + 1) % pool.length]?.id ?? "";
      const c = pool[(slotIndex + 2) % pool.length]?.id ?? "";
      return [a, b, c].filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index).slice(0, 3);
    });

    void saveWeeklyScrimPlans(next);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          <Swords className="mr-1.5 inline size-4 text-amber-400" />
          {t("training.scrims.title")}
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-border px-2 py-0.5 font-heading text-2xs tabular-nums text-muted-foreground">
            {t("training.scrims.weekCapacity")}: {slots}
          </span>
          {streak > 0 && (
            <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-heading text-2xs font-bold tabular-nums text-red-400">
              {streak}L
            </span>
          )}
          <button
            type="button"
            disabled={isSaving || readOnly || !weeklyContext.slots.every((slot) => slot.canEdit)}
            onClick={autofillPlansFromObjective}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-heading text-2xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <WandSparkles className="size-3" />
            Rellenar
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: slots }).map((_, index) => {
            const slotContext = weeklyContext.slots[index];
            const labelDay = slotContext?.labelDay ?? 0;
            const labelSuffix = slotContext?.labelSuffix ? ` ${slotContext.labelSuffix}` : "";
            const slotLabel = `${weekdayLabels[labelDay] ?? weekdayLabels[0]}${labelSuffix}`;
            const hasResult = slotContext?.resultWon != null;
            const primaryOpponentId = selected[index] || slotContext?.resolvedOpponentTeamId || "";
            const isLocked = isSaving || readOnly || !slotContext?.canEdit;
            const primaryLogo = primaryOpponentId ? teamLogo(gameState.teams, primaryOpponentId) : null;

            return (
              <div
                key={`scrim-slot-${index}`}
                className={cn(
                  "rounded-xl border p-4 transition-colors",
                  hasResult && slotContext?.resultWon
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : hasResult
                      ? "border-red-500/20 bg-red-500/5"
                      : "border-border bg-muted/20",
                )}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <CalendarDays className="size-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                        {t("training.scrims.slot", "Slot")} {index + 1}
                      </p>
                      <p className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
                        {slotLabel}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {primaryLogo && (
                      <img src={primaryLogo} alt="" className="size-8 rounded-lg object-contain" />
                    )}
                    {hasResult ? (
                      <Badge className={slotContext?.resultWon ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}>
                        {slotContext?.resultWon ? "W" : "L"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        {t("training.scrims.pending", "Pendiente")}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, priorityIndex) => {
                    const label = priorityIndex === 0
                      ? t("training.scrims.planA", "Plan A")
                      : priorityIndex === 1
                        ? t("training.scrims.planB", "Plan B")
                        : t("training.scrims.planC", "Plan C");
                    const Icon: LucideIcon = priorityIndex === 0 ? Swords : ChevronRight;

                    return (
                      <div key={`scrim-slot-${index}-plan-${priorityIndex}`}>
                        <label className="mb-1 flex items-center gap-1 font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                          <Icon className="size-3" />
                          {label}
                        </label>
                        <select
                          value={plans[index]?.[priorityIndex] ?? ""}
                          onChange={(e) => setSlotPlan(index, priorityIndex, e.target.value)}
                          disabled={isLocked}
                          className={cn(
                            "w-full rounded-md border px-2.5 py-1.5 text-xs text-foreground outline-none transition-colors",
                            priorityIndex === 0
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-muted/30",
                            isLocked && "opacity-50",
                          )}
                        >
                          <option value="">
                            {priorityIndex === 0
                              ? t("training.scrims.selectOpponent", "Select rival")
                              : t("training.scrims.noFallback", "Sin alternativa")}
                          </option>
                          {options.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name} · OVR {teamOvrById.get(team.id) ?? 74}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
