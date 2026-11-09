import type { PlayerData } from "../../store/gameStore";
import { calculateLolOvr } from "../../lib/players/lolPlayerStats";
import { resolvePlayerLolRole } from "../../lib/players/lolIdentity";
import { MAX_IMPORTS_IN_STARTING_FIVE, countImports, isImportPlayer } from "./imports";

export type SquadSection = "xi" | "bench";
export type DragState = {
  playerId: string;
  from: SquadSection;
  slotIndex: number | null;
};

export type PitchRow = { label: string; y: string; positions: string[] };
export type PitchSlot = {
  index: number;
  position: string;
  player: PlayerData | null;
};
export type PitchSlotRow = PitchRow & { slots: PitchSlot[] };
export type LolRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";
export type ActiveLineupSlot = {
  index: number;
  role: LolRole;
  player: PlayerData | null;
};

export const LOL_ACTIVE_ROLES: readonly LolRole[] = [
  "TOP",
  "JUNGLE",
  "MID",
  "ADC",
  "SUPPORT",
] as const;

export const LOL_ROLE_LABELS: Record<LolRole, string> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUPPORT",
};

const POSITION_LABELS: Record<string, string> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUPPORT",
};

const POSITION_CODES: Record<string, string> = {
  TOP: "TOP",
  JUNGLE: "JNG",
  MID: "MID",
  ADC: "ADC",
  SUPPORT: "SUP",
};

export function canonicalPosition(position?: string | null): string {
  const trimmed = (position ?? "").trim();
  if (!trimmed) return trimmed;

  if (LOL_ACTIVE_ROLES.includes(trimmed.toUpperCase() as LolRole)) {
    return trimmed.toUpperCase();
  }

  return trimmed;
}

export function normalisePosition(position?: string | null): string {
  return canonicalPosition(position);
}

export function positionCode(position?: string | null): string {
  const normalized = canonicalPosition(position);
  return (
    POSITION_CODES[normalized] || normalized.substring(0, 3).toUpperCase()
  );
}

export function translatePositionLabel(
  translateFnOrPosition: string | ((key: string, options?: { defaultValue?: string }) => string),
  positionOrTranslateFn?: string | ((key: string, options?: { defaultValue?: string }) => string),
): string {
  let translateFn: (key: string, options?: { defaultValue?: string }) => string;
  let position: string | null | undefined;

  if (typeof translateFnOrPosition === "function") {
    translateFn = translateFnOrPosition;
    position = positionOrTranslateFn as string | null | undefined;
  } else if (typeof positionOrTranslateFn === "function") {
    translateFn = positionOrTranslateFn;
    position = translateFnOrPosition;
  } else {
    return translateFnOrPosition ?? "";
  }

  const canonical = canonicalPosition(position);

  return translateFn(`common.positions.${canonical}`, {
    defaultValue: POSITION_LABELS[canonical] || canonical,
  });
}

export function translatePositionAbbreviation(
  translateFnOrPosition: string | ((key: string, options?: { defaultValue?: string }) => string),
  positionOrTranslateFn?: string | ((key: string, options?: { defaultValue?: string }) => string),
): string {
  let translateFn: (key: string, options?: { defaultValue?: string }) => string;
  let position: string | null | undefined;

  if (typeof translateFnOrPosition === "function") {
    translateFn = translateFnOrPosition;
    position = positionOrTranslateFn as string | null | undefined;
  } else if (typeof positionOrTranslateFn === "function") {
    translateFn = positionOrTranslateFn;
    position = translateFnOrPosition;
  } else {
    return translateFnOrPosition ?? "";
  }

  const normalized = canonicalPosition(position);

  return translateFn(`common.posAbbr.${normalized}`, {
    defaultValue: positionCode(position),
  });
}

/** @deprecated Use `resolvePlayerLolRole` from `@/lib/players/lolIdentity` directly */
export const getLolRoleForPlayer = resolvePlayerLolRole;

export function getPreferredPositions(player: PlayerData): string[] {
  const resolved = resolvePlayerLolRole(player);
  const alternates = (player.alternate_positions || [])
    .map(canonicalPosition)
    .filter((p) => p !== resolved);
  return [resolved, ...alternates];
}

/**
 * Returns 5 fixed LoL lane rows for display (replaces football pitch rows).
 */
export function buildLaneRows(): PitchRow[] {
  return [
    { label: "TOP", y: "16%", positions: ["TOP"] },
    { label: "JNG", y: "34%", positions: ["JUNGLE"] },
    { label: "MID", y: "52%", positions: ["MID"] },
    { label: "ADC", y: "70%", positions: ["ADC"] },
    { label: "SUP", y: "88%", positions: ["SUPPORT"] },
  ];
}

export function buildActiveLineupIds(
  available: PlayerData[],
  savedIds: string[],
): string[] {
  const byId = new Map(available.map((player) => [player.id, player]));
  const used = new Set<string>();
  const activeIds: string[] = Array(LOL_ACTIVE_ROLES.length).fill("");

  LOL_ACTIVE_ROLES.forEach((role, index) => {
    const savedSlotPlayer = byId.get(savedIds[index] ?? "");

    if (
      savedSlotPlayer &&
      !used.has(savedSlotPlayer.id) &&
      resolvePlayerLolRole(savedSlotPlayer) === role
    ) {
      activeIds[index] = savedSlotPlayer.id;
      used.add(savedSlotPlayer.id);
      return;
    }

    const savedRolePlayer = savedIds
      .map((id) => byId.get(id))
      .find(
        (player): player is PlayerData =>
          player !== undefined && !used.has(player.id) && resolvePlayerLolRole(player) === role,
      );

    if (savedRolePlayer) {
      activeIds[index] = savedRolePlayer.id;
      used.add(savedRolePlayer.id);
      return;
    }

    const roleCandidates = available
      .filter((player) => !used.has(player.id) && getLolRoleForPlayer(player) === role)
      .sort((a, b) => calculateLolOvr(b) - calculateLolOvr(a));

    const bestRolePlayer = roleCandidates[0];
    if (bestRolePlayer) {
      activeIds[index] = bestRolePlayer.id;
      used.add(bestRolePlayer.id);
    }
  });

  return limitLineupImports(activeIds, available);
}

/**
 * Swaps excess imports for the same-role resident that costs the least rating,
 * so the built five respects the import limit. A role with no resident keeps
 * its import (the backend refuses the save and the UI says why).
 */
function limitLineupImports(activeIds: string[], available: PlayerData[]): string[] {
  const byId = new Map(available.map((player) => [player.id, player]));
  const ids = [...activeIds];
  const starters = () => ids.map((id) => byId.get(id)).filter((p): p is PlayerData => p !== undefined);

  while (countImports(starters()) > MAX_IMPORTS_IN_STARTING_FIVE) {
    const used = new Set(ids);
    let best: { slot: number; replacement: PlayerData; loss: number } | null = null;
    ids.forEach((id, slot) => {
      const starter = byId.get(id);
      if (!starter || !isImportPlayer(starter)) return;
      const role = getLolRoleForPlayer(starter);
      available
        .filter(
          (candidate) =>
            !used.has(candidate.id) &&
            !isImportPlayer(candidate) &&
            getLolRoleForPlayer(candidate) === role,
        )
        .forEach((candidate) => {
          const loss = calculateLolOvr(starter) - calculateLolOvr(candidate);
          if (!best || loss < best.loss) best = { slot, replacement: candidate, loss };
        });
    });
    if (!best) break;
    const { slot, replacement } = best as { slot: number; replacement: PlayerData };
    ids[slot] = replacement.id;
  }
  return ids;
}

export function buildActiveLineupSlots(
  roles: readonly LolRole[],
  activeIds: string[],
  playersById: Map<string, PlayerData>,
): ActiveLineupSlot[] {
  return roles.map((role, index) => ({
    index,
    role,
    player: playersById.get(activeIds[index]) ?? null,
  }));
}

export function buildActivePositionMap(
  slotsOrRows: PitchSlotRow[] | ActiveLineupSlot[],
): Map<string, string> {
  const map = new Map<string, string>();

  slotsOrRows.forEach((entry) => {
    if ("slots" in entry) {
      entry.slots.forEach((slot) => {
        if (slot.player) {
          map.set(slot.player.id, canonicalPosition(slot.position));
        }
      });
      return;
    }

    if (entry.player) {
      map.set(entry.player.id, entry.role);
    }
  });
  return map;
}

export function isPlayerOutOfPosition(
  player: PlayerData,
  currentPos: string,
): boolean {
  const resolved = resolvePlayerLolRole(player);
  if (resolved === canonicalPosition(currentPos)) return false;
  return !getPreferredPositions(player).includes(canonicalPosition(currentPos));
}

export function applyLineupDrop(
  currentXiIds: string[],
  dragState: DragState,
  slotIndex: number,
): string[] {
  const nextXiIds = [...currentXiIds];

  if (slotIndex < 0 || slotIndex >= nextXiIds.length) {
    return nextXiIds;
  }

  if (dragState.from === "xi") {
    const fromIndex =
      dragState.slotIndex ?? nextXiIds.indexOf(dragState.playerId);
    if (fromIndex < 0 || fromIndex === slotIndex) {
      return nextXiIds;
    }
    [nextXiIds[fromIndex], nextXiIds[slotIndex]] = [
      nextXiIds[slotIndex],
      nextXiIds[fromIndex],
    ];
    return nextXiIds;
  }

  const existingIndex = nextXiIds.indexOf(dragState.playerId);
  if (existingIndex === slotIndex) {
    return nextXiIds;
  }
  if (existingIndex >= 0) {
    nextXiIds.splice(existingIndex, 1);
    if (existingIndex < slotIndex) {
      slotIndex -= 1;
    }
    nextXiIds.splice(slotIndex, 0, dragState.playerId);
    return nextXiIds.slice(0, currentXiIds.length);
  }
  if (slotIndex >= nextXiIds.length) {
    nextXiIds.push(dragState.playerId);
  } else {
    nextXiIds[slotIndex] = dragState.playerId;
  }
  return nextXiIds.slice(0, currentXiIds.length);
}

export function applyLineupSwap(
  currentXiIds: string[],
  swapSource: { id: string; from: SquadSection },
  playerId: string,
  from: SquadSection,
): string[] | null {
  if (swapSource.from === "xi" && from === "bench") {
    return currentXiIds.map((id) => (id === swapSource.id ? playerId : id));
  }

  if (swapSource.from === "bench" && from === "xi") {
    return currentXiIds.map((id) => (id === playerId ? swapSource.id : id));
  }

  if (swapSource.from === "xi" && from === "xi") {
    const firstIndex = currentXiIds.indexOf(swapSource.id);
    const secondIndex = currentXiIds.indexOf(playerId);
    if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) {
      return currentXiIds;
    }
    const nextXiIds = [...currentXiIds];
    nextXiIds[firstIndex] = playerId;
    nextXiIds[secondIndex] = swapSource.id;
    return nextXiIds;
  }

  return null;
}
