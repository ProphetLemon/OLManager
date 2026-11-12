import { getApiClientSync } from "../api/client";
import type { SoloQDecayMode, SoloQDecaySettings, SoloQStatus } from "../api/types";
import type { GameStateData } from "../store/gameStore";

export async function startPotentialResearch(
  playerId: string,
): Promise<GameStateData> {
  return getApiClientSync().players.startPotentialResearch({ playerId });
}

export async function setPlayerChampionTrainingTarget(
  playerId: string,
  priorityIndex: number,
  championId: string | null,
): Promise<GameStateData> {
  return getApiClientSync().players.setChampionTrainingTarget({
    playerId,
    priorityIndex,
    championId: championId ?? "",
  });
}

export async function delegateChampionTraining(): Promise<GameStateData> {
  return getApiClientSync().players.delegateChampionTraining();
}

export async function getSoloQStatuses(): Promise<SoloQStatus[]> {
  return getApiClientSync().players.getSoloQStatuses();
}

export async function getSoloQDecaySettings(): Promise<SoloQDecaySettings> {
  return getApiClientSync().players.getSoloQDecaySettings();
}

export async function setSoloQDecayMode(mode: SoloQDecayMode): Promise<SoloQDecaySettings> {
  return getApiClientSync().players.setSoloQDecayMode({ mode });
}

export type { SoloQDecayMode, SoloQDecaySettings, SoloQStatus };
