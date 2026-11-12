import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { WandSparkles } from "lucide-react";

import {
  buildTeamLolOvrMap,
  type WeeklyScrimContext,
} from "@/lib/scrims/scrimContext";
import { isPlanClearedToday } from "@/lib/scrims/scrimDesk";
import { setWeeklyScrimPlans } from "@/services/trainingService";
import type { GameStateData } from "@/store/gameStore";
import { Button } from "@/ui-v2/components/ui/button";
import { cn } from "@/ui-v2/lib/utils";
import { SLOT_STATUS_ICON, SLOT_STATUS_KEY } from "./scrims/slotStatus";

interface ScrimPlanningCardV2Props {
  gameState: GameStateData;
  weeklyContext: WeeklyScrimContext;
  onGameUpdate?: (state: GameStateData) => void;
  isSaving: boolean;
  setIsSaving: (value: boolean) => void;
  readOnly?: boolean;
  /** `recap` shows the locked plans as text, the way they stay readable after the week starts. */
  variant?: "edit" | "recap";
}

const ROW_GRID = "md:grid-cols-[minmax(10.5rem,1.1fr)_repeat(3,minmax(0,1fr))]";

/** The opponent plans of the week: Plan A, B and C for each slot. It lives inside the setup panel. */
export default function ScrimPlanningCardV2({
  gameState,
  weeklyContext,
  onGameUpdate,
  isSaving,
  setIsSaving,
  readOnly = false,
  variant = "edit",
}: ScrimPlanningCardV2Props) {
  const { t } = useTranslation();
  const weekdayLabels = [
    t("training.days.mon"), t("training.days.tue"), t("training.days.wed"),
    t("training.days.thu"), t("training.days.fri"), t("training.days.sat"), t("training.days.sun"),
  ];
  const planLabels = [t("training.scrims.planA"), t("training.scrims.planB"), t("training.scrims.planC")];

  const myTeam = gameState.teams.find((team) => team.id === gameState.manager.team_id);
  const teamOvrById = useMemo(() => buildTeamLolOvrMap(gameState), [gameState]);

  const options = useMemo(
    () => (myTeam
      ? gameState.teams
        .filter((team) => team.id !== myTeam.id)
        .filter((team) => team.competition_id === myTeam.competition_id)
        .sort((a, b) => (teamOvrById.get(b.id) ?? 0) - (teamOvrById.get(a.id) ?? 0) || a.name.localeCompare(b.name))
      : []),
    [gameState.teams, myTeam, teamOvrById],
  );
  if (!myTeam) return null;

  const slots = weeklyContext.capacity;
  const plans = Array.from({ length: slots }, (_, slotIndex) => {
    const merged = weeklyContext.slots[slotIndex]?.plan ?? [];
    return Array.from({ length: 3 }, (_, priorityIndex) => merged[priorityIndex] ?? "");
  });
  const teamNameById = new Map(gameState.teams.map((team) => [team.id, team.name]));

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
    <section aria-labelledby="scrim-plans-heading" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id="scrim-plans-heading" className="font-heading text-lg font-semibold uppercase leading-tight tracking-wide">
          {t("scrims.opponentPlans")}
        </h3>
        {variant === "edit" ? (
          <Button
            type="button"
            variant="outline"
            size="touch"
            disabled={isSaving || readOnly || !weeklyContext.slots.every((slot) => slot.canEdit)}
            onClick={autofillPlansFromObjective}
          >
            <WandSparkles aria-hidden="true" />
            {t("training.scrims.autofill")}
          </Button>
        ) : null}
      </div>

      <div role="table" aria-label={t("scrims.opponentPlansBySlot")} className="flex flex-col">
        <div
          role="row"
          className={cn("hidden gap-3 pb-1 font-heading text-base font-semibold uppercase tracking-wide text-muted-foreground md:grid", ROW_GRID)}
        >
          <div role="columnheader">{t("training.scrims.slot")}</div>
          {planLabels.map((label) => (
            <div key={label} role="columnheader">{label}</div>
          ))}
        </div>
        {Array.from({ length: slots }).map((_, index) => {
          const slotContext = weeklyContext.slots[index];
          const labelDay = slotContext?.labelDay ?? 0;
          const labelSuffix = slotContext?.labelSuffix ? ` ${slotContext.labelSuffix}` : "";
          const slotLabel = `${weekdayLabels[labelDay] ?? weekdayLabels[0]}${labelSuffix}`;
          const status = slotContext?.status ?? "Open";
          const StatusIcon = SLOT_STATUS_ICON[status];
          const isLocked = isSaving || readOnly || !slotContext?.canEdit;
          const cleared = slotContext ? isPlanClearedToday(slotContext, weeklyContext) : false;
          const resolvedId = slotContext?.resolvedOpponentTeamId ?? null;

          return (
            <div
              key={`scrim-slot-${index}`}
              role="row"
              className={cn("grid gap-2 border-t border-line py-2 md:items-center md:gap-3", ROW_GRID)}
            >
              <div role="cell" className="flex items-center gap-2.5">
                <span className="font-heading text-lg font-semibold uppercase leading-none tracking-wide">{slotLabel}</span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
                  <StatusIcon aria-hidden="true" className="size-4 shrink-0" />
                  {t(SLOT_STATUS_KEY[status])}
                </span>
              </div>
              {planLabels.map((planLabel, priorityIndex) => {
                const value = plans[index]?.[priorityIndex] ?? "";
                return (
                  <div key={`scrim-slot-${index}-plan-${priorityIndex}`} role="cell" className="flex flex-col gap-1">
                    <span className="text-caption font-medium text-muted-foreground md:hidden">{planLabel}</span>
                    {variant === "edit" ? (
                      <select
                        aria-label={`${slotLabel}, ${planLabel}`}
                        value={value}
                        onChange={(e) => setSlotPlan(index, priorityIndex, e.target.value)}
                        disabled={isLocked}
                        className="min-h-11 w-full rounded-lg border border-dim bg-background px-2.5 text-sm text-foreground transition-colors hover:border-foreground disabled:opacity-60 disabled:hover:border-dim"
                      >
                        <option value="">
                          {priorityIndex === 0 ? t("training.scrims.selectOpponent") : t("training.scrims.noFallback")}
                        </option>
                        {options.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name} · OVR {teamOvrById.get(team.id) ?? 74}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={cn(
                          "flex min-h-11 flex-wrap items-center gap-2 text-sm",
                          value ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {value
                          ? teamNameById.get(value) ?? value
                          : cleared
                            ? priorityIndex === 0 ? t("scrims.planCleared") : "-"
                            : priorityIndex === 0 ? t("scrims.noOpponentSet") : t("training.scrims.noFallback")}
                        {value && resolvedId === value ? (
                          <span className="rounded border border-positive px-1.5 py-px text-caption text-positive">
                            {t("scrims.played")}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
