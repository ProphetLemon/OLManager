import { useMemo } from "react";
import { scrimOpponentLogo } from "@/lib/scrims/opponentLogo";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, WandSparkles, Swords } from "lucide-react";

import {
  buildTeamLolOvrMap,
  type WeeklyScrimContext,
} from "@/lib/scrims/scrimContext";
import { setWeeklyScrimPlans } from "@/services/trainingService";
import type { GameStateData } from "@/store/gameStore";
import { Card, CardBody, CardHeader, Select } from "@/ui-v2/_legacy/components/ui";

interface ScrimPlanningCardProps {
  gameState: GameStateData;
  weeklyContext: WeeklyScrimContext;
  onGameUpdate?: (state: GameStateData) => void;
  isSaving: boolean;
  setIsSaving: (value: boolean) => void;
  readOnly?: boolean;
}

function opponentLabel(teamName: string, ovr: number): string {
  return `${teamName} · OVR ${ovr}`;
}

export default function ScrimPlanningCard({
  gameState,
  weeklyContext,
  onGameUpdate,
  isSaving,
  setIsSaving,
  readOnly = false,
}: ScrimPlanningCardProps) {
  const { t } = useTranslation();
  const weekdayLabels = [
    t("training.days.mon"),
    t("training.days.tue"),
    t("training.days.wed"),
    t("training.days.thu"),
    t("training.days.fri"),
    t("training.days.sat"),
    t("training.days.sun"),
  ];

  const myTeam = gameState.teams.find((team) => team.id === gameState.manager.team_id);
  if (!myTeam) return null;

  const slots = weeklyContext.capacity;
  const plans = Array.from({ length: slots }, (_, slotIndex) => {
    const merged = weeklyContext.slots[slotIndex]?.plan ?? [];
    return Array.from({ length: 3 }, (_, priorityIndex) => merged[priorityIndex] ?? "");
  });
  const selected = plans.map((plan) => plan[0] ?? "");

  const teamOvrById = useMemo(() => {
    return buildTeamLolOvrMap(gameState);
  }, [gameState.players, gameState.teams]);

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
      <CardHeader>
        <span className="inline-flex items-center gap-2">
          <Swords className="w-4 h-4 text-amber-400" />
          {t("training.scrims.title")}
        </span>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
          {t(
            "training.scrims.description",
          )}
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-gray-300 dark:border-navy-600 px-2.5 py-1 text-xs font-heading uppercase tracking-wide text-gray-600 dark:text-gray-300">
            {t("training.scrims.weekCapacity")}: {slots}
          </span>
          <span className="rounded-full border border-gray-300 dark:border-navy-600 px-2.5 py-1 text-xs font-heading uppercase tracking-wide text-gray-600 dark:text-gray-300">
            {t("training.scrims.lossStreak")}: {streak}
          </span>
          <button
            type="button"
            disabled={isSaving || readOnly || !weeklyContext.slots.every((slot) => slot.canEdit)}
            onClick={autofillPlansFromObjective}
            className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2.5 py-1 text-xs font-heading uppercase tracking-wide text-gray-600 transition-colors hover:border-gray-400 disabled:opacity-60 dark:border-navy-600 dark:text-gray-300 dark:hover:border-navy-500"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            Rellenar por objetivo
          </button>
        </div>

        <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-navy-600 dark:bg-navy-900/40">
          {Array.from({ length: slots }).map((_, index) => {
            const slotContext = weeklyContext.slots[index];
            const labelDay = slotContext?.labelDay ?? 0;
            const labelSuffix = slotContext?.labelSuffix ? ` ${slotContext.labelSuffix}` : "";
            const slotLabel = `${weekdayLabels[labelDay] ?? weekdayLabels[0]}${labelSuffix}`;
            const hasResult = slotContext?.resultWon != null;
            const primaryOpponentId = selected[index] || slotContext?.resolvedOpponentTeamId || "";
            const isLocked = isSaving || readOnly || !slotContext?.canEdit;

            return (
              <div
                key={`scrim-slot-${index}`}
                className="rounded-2xl border border-gray-200 bg-white/80 p-3 shadow-sm dark:border-navy-600 dark:bg-navy-800/70"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-500 dark:text-primary-300">
                      <CalendarDays className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xs font-heading font-bold uppercase tracking-wider text-gray-400">
                        {t("training.scrims.slot", "Slot")} {index + 1}
                      </p>
                      <p className="truncate font-heading text-sm font-bold uppercase tracking-wide text-gray-900 dark:text-white">
                        {slotLabel}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {primaryOpponentId ? (
                      <img
                        src={scrimOpponentLogo(gameState.teams, primaryOpponentId)}
                        alt={t("training.scrims.opponentLogoAlt")}
                        className="h-8 w-8 rounded-lg bg-black/20 object-contain p-1"
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    {hasResult ? (
                      <span
                        className={`rounded-full border px-2.5 py-1 text-2xs font-heading font-bold uppercase tracking-wide ${slotContext?.resultWon ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300" : "border-rose-400/40 bg-rose-500/15 text-rose-300"}`}
                      >
                        {slotContext?.resultWon ? "Win" : "Loss"}
                      </span>
                    ) : (
                      <span className="rounded-full border border-gray-200 px-2.5 py-1 text-2xs font-heading font-bold uppercase tracking-wide text-gray-400 dark:border-navy-600">
                        {t("training.scrims.pending", "Pendiente")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, priorityIndex) => {
                    const label = priorityIndex === 0
                      ? t("training.scrims.planA", "Plan A")
                      : priorityIndex === 1
                        ? t("training.scrims.planB", "Plan B")
                        : t("training.scrims.planC", "Plan C");

                    return (
                      <div key={`scrim-slot-${index}-plan-${priorityIndex}`} className="min-w-0">
                        <label className="mb-1 flex items-center gap-1 text-2xs font-heading font-bold uppercase tracking-wider text-gray-400">
                          {priorityIndex > 0 ? <ChevronRight className="h-3 w-3" /> : null}
                          {label}
                        </label>
                        <Select
                          value={plans[index]?.[priorityIndex] ?? ""}
                          onChange={(event) => setSlotPlan(index, priorityIndex, event.target.value)}
                          disabled={isLocked}
                          variant={priorityIndex === 0 ? "highlighted" : "muted"}
                          selectSize="sm"
                          fullWidth
                          dropdownPlacement="auto"
                          dropdownClassName="min-w-[18rem]"
                        >
                          <option value="">
                            {priorityIndex === 0
                              ? t("training.scrims.selectOpponent", "Select rival")
                              : t("training.scrims.noFallback", "Sin alternativa")}
                          </option>
                          {options.map((team) => (
                            <option key={team.id} value={team.id}>
                              {opponentLabel(team.name, teamOvrById.get(team.id) ?? 74)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

