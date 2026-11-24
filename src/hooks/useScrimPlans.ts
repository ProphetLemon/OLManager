import { useCallback, useMemo } from "react";

import { buildTeamLolOvrMap, type WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { autofillPlans, planGrid, rivalTeams, withPlan } from "@/lib/scrims/scrimPlans";
import { setWeeklyScrimPlans } from "@/services/trainingService";
import type { GameStateData } from "@/store/gameStore";

interface UseScrimPlansArgs {
  gameState: GameStateData;
  weeklyContext: WeeklyScrimContext;
  onGameUpdate?: (state: GameStateData) => void;
  setIsSaving: (value: boolean) => void;
}

/** The week's plan grid with the two ways to change it, each one saved at once. Shared by the desktop grid and the phone panes. */
export function useScrimPlans({ gameState, weeklyContext, onGameUpdate, setIsSaving }: UseScrimPlansArgs) {
  const myTeam = gameState.teams.find((team) => team.id === gameState.manager.team_id);
  const teamOvrById = useMemo(() => buildTeamLolOvrMap(gameState), [gameState]);
  const options = useMemo(
    () => (myTeam ? rivalTeams([...gameState.teams], myTeam, teamOvrById) : []),
    [gameState.teams, myTeam, teamOvrById],
  );
  const plans = planGrid(weeklyContext);

  const save = useCallback(
    async (next: string[][]): Promise<boolean> => {
      setIsSaving(true);
      try {
        onGameUpdate?.(await setWeeklyScrimPlans(next));
        return true;
      } catch (error) {
        console.error("Failed to save weekly scrim plans:", error);
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [onGameUpdate, setIsSaving],
  );

  /** Sets one plan of one slot; an empty `teamId` clears it. */
  const setSlotPlan = (slotIndex: number, priorityIndex: number, teamId: string) => {
    void save(withPlan(plans, slotIndex, priorityIndex, teamId));
  };

  /** Resolves to the number of blocks filled once saved; null when nobody could be dealt or the save failed. */
  const autofill = async (): Promise<number | null> => {
    const next = autofillPlans(options.map((team) => team.id), weeklyContext.objective, weeklyContext.capacity);
    return next && (await save(next)) ? next.length : null;
  };

  return { myTeam, teamOvrById, options, plans, setSlotPlan, autofill };
}
