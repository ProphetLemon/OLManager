import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MatchEvent, MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import { mergeMatchEvents, mapRuntimeEventsToMatchEvents } from "@/ui-v2/_legacy/components/match/matchRuntimeEvents";
import { getWalls } from "@/ui-v2/_legacy/components/match/lol-prototype/assets/map";
import { NavGrid } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/navigation";
import { PrototypeSimulation } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation";
import type { ChampionCombatProfile } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation";
import type { MatchState } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";
import {
  createDefaultObjectivesState,
  createEmptyNeutralTimersState,
  type LolChampionUltimateProfile,
  type LolSimV1AiMode,
  type LolSimV1PolicyConfig,
  type LolSimV1RuntimeState,
} from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import { LolSimV2Client } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/tauri-client";
import { renderSimulation } from "@/ui-v2/_legacy/components/match/lol-prototype/ui/render";
import { LecLowerThirdPanel } from "@/ui-v2/_legacy/components/match/lol-prototype/ui/panels";
import { buildChampionProfiles, loadChampionKits } from "@/ui-v2/_legacy/components/match/championProfiles";
import { championPlaysRole, resolveRoleTier } from "@/lib/champions/championRoleFit";
import { useSettingsStore } from "@/store/settingsStore";
import type { GameStateData } from "@/store/gameStore";


export interface ChampionSelectionByPlayer {
  home: Record<string, string>;
  away: Record<string, string>;
  homeRoles: Record<string, "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT">;
  awayRoles: Record<string, "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT">;
}

interface Props {
  snapshot: MatchSnapshot;
  gameState: GameStateData | null;
  blueTeamId?: string;
  championSelections?: ChampionSelectionByPlayer | null;
  onSnapshotUpdate: (snap: MatchSnapshot) => void;
  onImportantEvent: (evt: MatchEvent) => void;
  onFullTime: (finalState: LolSimV1RuntimeState, meta?: { source: "live" | "skip" }) => void;
}

const SPEEDS = [
  { id: "x1", value: 4 },
  { id: "x2", value: 8 },
  { id: "x4", value: 16 },
  { id: "x8", value: 32 },
  { id: "x12", value: 48 }
];

const USE_RUST_SIM_V2 = true;
const ICON_TOWER = "/lol-map-icons/icon_ui_tower_minimap.webp";
const ICON_GOLD = "/lol-map-icons/gold.webp";
const ICON_VOIDGRUB = "/lol-map-icons/grub.webp";
const DEFAULT_DRAGON_ICON = "/lol-map-icons/dragon.webp";

const TEAM_BRAND_MAP: Record<string, { tricode: string; logo: string | null }> = {
  g2esports: { tricode: "G2", logo: "/teams-icons/g2-esports.webp" },
  fnatic: { tricode: "FNC", logo: "/teams-icons/fnatic.webp" },
  teamvitality: { tricode: "VIT", logo: "/teams-icons/team-vitality.webp" },
  teamheretics: { tricode: "HRTS", logo: "/teams-icons/team-heretics-lec.webp" },
  skgaming: { tricode: "SK", logo: "/teams-icons/sk-gaming.webp" },
  movistarkoi: { tricode: "MKOI", logo: "/teams-icons/mad-lions.webp" },
  mkoi: { tricode: "MKOI", logo: "/teams-icons/mad-lions.webp" },
  koi: { tricode: "MKOI", logo: "/teams-icons/mad-lions.webp" },
  madlionskoi: { tricode: "MKOI", logo: "/teams-icons/mad-lions.webp" },
  teambds: { tricode: "SHFT", logo: "/teams-icons/shifters.webp" },
  shifters: { tricode: "SHFT", logo: "/teams-icons/shifters.webp" },
  giantx: { tricode: "GX", logo: "/teams-icons/giantx-lec.webp" },
  natusvincere: { tricode: "NAVI", logo: "/teams-icons/natus-vincere.webp" },
  karminecorp: { tricode: "KC", logo: "/teams-icons/karmine-corp.webp" },
};

function championIconUrl(championId: string): string {
  return `/champion-tiles/${championId}.webp`;
}

function randomSeed10Digits() {
  const firstDigit = Math.floor(Math.random() * 9) + 1;
  const rest = Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0");
  return `${firstDigit}${rest}`;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function teamBrand(name: string, teams?: import("@/store/types").TeamData[]): { tag: string; logo: string | null } {
  const normalized = normalizeKey(name);

  if (teams) {
    const fromTeams = teams.find((t) => normalizeKey(t.name) === normalized);
    if (fromTeams) return { tag: fromTeams.short_name, logo: fromTeams.logo_url ?? null };
  }

  const known = TEAM_BRAND_MAP[normalized];
  if (known) return { tag: known.tricode, logo: known.logo };

  return { tag: teamTag(name), logo: null };
}

function countVoidgrubsBySide(events: LolSimV1RuntimeState["events"] | undefined, side: "blue" | "red"): number {
  if (!events || events.length === 0) return 0;
  const sideTokenRegex = side === "blue"
    ? /\b(BLUE|HOME)\b/
    : /\b(RED|AWAY)\b/;

  return events.reduce((total, event) => {
    const text = (event.text ?? "").toUpperCase();
    if (!text.includes("VOIDGRUB") || !sideTokenRegex.test(text)) return total;
    if (!text.includes("SECURED")) return total;

    const amountMatch = text.match(/(\d+)\s*VOIDGRUB/);
    if (amountMatch?.[1]) return total + Number(amountMatch[1]);

    // Most runtime logs use "secured voidgrubs" for full camp (3 units)
    if (text.includes("VOIDGRUBS")) return total + 3;

    return total + 1;
  }, 0);
}

function runtimeTeamBuffs(
  runtime: LolSimV1RuntimeState | null,
  side: "blue" | "red",
): { voidgrub_stacks?: number; dragon_history?: string[] } | null {
  if (!runtime) return null;
  const runtimeAny = runtime as unknown as {
    team_buffs?: {
      blue?: { voidgrub_stacks?: number; dragon_history?: string[] };
      red?: { voidgrub_stacks?: number; dragon_history?: string[] };
    };
    teamBuffs?: {
      blue?: { voidgrub_stacks?: number; dragon_history?: string[] };
      red?: { voidgrub_stacks?: number; dragon_history?: string[] };
    };
    extra?: {
      teamBuffs?: {
        blue?: { voidgrub_stacks?: number; dragon_history?: string[] };
        red?: { voidgrub_stacks?: number; dragon_history?: string[] };
      };
    };
  };

  const buffs = runtimeAny.teamBuffs?.[side] ?? runtimeAny.team_buffs?.[side] ?? runtimeAny.extra?.teamBuffs?.[side];
  return buffs ?? null;
}

function teamTag(name: string) {
  const parts = name
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 3)}`.toUpperCase();
  }

  return (parts[0] ?? name).slice(0, 4).toUpperCase();
}

function formatGoldCompact(value: number | undefined) {
  const safe = Math.max(0, value ?? 0);
  if (safe >= 1000) return `${(safe / 1000).toFixed(1)}K`;
  return `${safe}`;
}

function dragonIconForKind(kind: string | null | undefined): string {
  const normalized = (kind ?? "").toLowerCase();
  if (normalized.includes("mountain")) return "/lol-map-icons/dragon_mountain.webp";
  if (normalized.includes("cloud")) return "/lol-map-icons/dragon_cloud.webp";
  if (normalized.includes("ocean")) return "/lol-map-icons/dragon_ocean.webp";
  if (normalized.includes("hextech")) return "/lol-map-icons/dragon_hextech.webp";
  if (normalized.includes("chemtech")) return "/lol-map-icons/dragon_chemtech.webp";
  if (normalized.includes("elder")) return "/lol-map-icons/dragon_elder.webp";
  if (normalized.includes("infernal") || normalized.includes("fire")) return "/lol-map-icons/dragon_infernal.webp";
  return "/lol-map-icons/dragon.webp";
}

function dragonKillIconsBySide(
  events: LolSimV1RuntimeState["events"] | undefined,
  side: "blue" | "red",
  expectedCount: number,
  teamDragonHistory?: string[],
): string[] {
  const parsedFromEvents = (() => {
    if (!events || events.length === 0) return [] as string[];
    const sideTokenRegex = side === "blue"
      ? /\b(BLUE|HOME)\b/
      : /\b(RED|AWAY)\b/;

    return events
      .filter((event) => event.type === "dragon")
      .filter((event) => {
        const text = (event.text ?? "").toUpperCase();
        return sideTokenRegex.test(text);
      })
      .map((event) => {
        const text = (event.text ?? "").toUpperCase();
        const match = text.match(/SECURED\s+([A-Z_]+)\s+(DRAGON|DRAKE)/);
        if (!match) return null;
        const kind = match?.[1]?.toLowerCase() ?? null;
        return dragonIconForKind(kind);
      })
      .filter((icon): icon is string => icon !== null)
      .slice(0, 6);
  })();

  if (teamDragonHistory && teamDragonHistory.length > 0) {
    const fromHistory = teamDragonHistory
      .map((kind) => dragonIconForKind(kind))
      .slice(0, 6);

    const merged = [...fromHistory];
    for (const icon of parsedFromEvents) {
      if (merged.length >= expectedCount) break;
      if (merged[merged.length - 1] !== icon || merged.length < parsedFromEvents.length) {
        merged.push(icon);
      }
    }

    if (merged.length >= expectedCount) {
      return merged.slice(0, expectedCount);
    }

    const padded = [...merged];
    while (padded.length < expectedCount) {
      padded.push("/lol-map-icons/dragon.webp");
    }
    return padded;
  }

  const parsed = parsedFromEvents;

  if (parsed.length >= expectedCount) {
    return parsed.slice(0, expectedCount);
  }

  if (expectedCount <= 0) return parsed;

  const fallback = [...parsed];
  while (fallback.length < expectedCount) {
    fallback.push(DEFAULT_DRAGON_ICON);
  }
  return fallback;
}

function normalizeChampionLookupKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sanitizeEventActorLabel(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b(BLUE|RED|HOME|AWAY)\b/gi, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function actorInitials(value: string | null | undefined, fallback: string): string {
  const cleaned = sanitizeEventActorLabel(value);
  if (!cleaned) return fallback;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return cleaned.slice(0, 2).toUpperCase() || fallback;
}

function parseKillText(text: string): { killerName: string; victimName: string } | null {
  const match = text.match(/^(.+?)\s+(killed|slain|eliminated)\s+(.+)$/i);
  if (!match) return null;
  return {
    killerName: sanitizeEventActorLabel(match[1]),
    victimName: sanitizeEventActorLabel(match[3]),
  };
}

function championsMentionedInText(
  text: string,
  champions: LolSimV1RuntimeState["champions"] | undefined,
): Array<{ name: string; id: string }> {
  const haystack = normalizeChampionLookupKey(text);
  if (!haystack) return [];
  return (champions ?? []).filter((champion) => {
    const nameKey = normalizeChampionLookupKey(champion.name);
    const idKey = normalizeChampionLookupKey(champion.id);
    return (nameKey.length > 2 && haystack.includes(nameKey))
      || (idKey.length > 2 && haystack.includes(idKey));
  }).map((champion) => ({ name: champion.name, id: champion.id }));
}

function resolveChampionPortrait(
  actorLabel: string,
  champions: LolSimV1RuntimeState["champions"] | undefined,
  iconByLookup: Record<string, string>,
): string | null {
  const actorKey = normalizeChampionLookupKey(actorLabel);
  if (!actorKey) return null;

  const direct = iconByLookup[actorKey];
  if (direct) return direct;

  const match = (champions ?? []).find((champion) => {
    const nameKey = normalizeChampionLookupKey(champion.name);
    const idKey = normalizeChampionLookupKey(champion.id);
    return nameKey === actorKey
      || idKey === actorKey
      || (nameKey.length > 2 && (nameKey.includes(actorKey) || actorKey.includes(nameKey)))
      || (idKey.length > 2 && (idKey.includes(actorKey) || actorKey.includes(idKey)));
  });

  if (!match) return null;

  return iconByLookup[normalizeChampionLookupKey(match.name)]
    ?? iconByLookup[normalizeChampionLookupKey(match.id)]
    ?? `/player-photos/${match.id}.webp`;
}

function objectiveIconForEvent(event: LolSimV1RuntimeState["events"][number]): string {
  const text = (event.text ?? "").toLowerCase();
  if (event.type === "dragon") {
    const kindMatch = text.match(/secured\s+([a-z_]+)\s+(dragon|drake)/i);
    return dragonIconForKind(kindMatch?.[1] ?? "dragon");
  }
  if (event.type === "baron") return "/lol-map-icons/baron.webp";
  if (event.type === "tower") return "/lol-map-icons/icon_ui_tower_minimap.webp";
  if (event.type === "nexus") return "/lol-map-icons/icon_ui_nexus_minimap_v2.webp";
  return "/lol-map-icons/camp.webp";
}

function sideFromRuntimeText(text: string | null | undefined): "blue" | "red" | null {
  const upper = (text ?? "").toUpperCase();
  if (/\b(RED|AWAY)\b/.test(upper)) return "red";
  if (/\b(BLUE|HOME)\b/.test(upper)) return "blue";
  return null;
}

function sideFromActorLabel(
  actorLabel: string,
  champions: LolSimV1RuntimeState["champions"] | undefined,
): "blue" | "red" | null {
  const key = normalizeChampionLookupKey(actorLabel);
  if (!key) return null;
  const match = (champions ?? []).find((champion) => {
    const nameKey = normalizeChampionLookupKey(champion.name);
    const idKey = normalizeChampionLookupKey(champion.id);
    return nameKey === key || idKey === key || nameKey.includes(key) || key.includes(nameKey) || idKey.includes(key) || key.includes(idKey);
  });
  if (!match) return null;
  return match.team === "red" ? "red" : "blue";
}

export default function LolMatchLive({ gameState, snapshot: initialSnapshot, blueTeamId, championSelections, onSnapshotUpdate, onImportantEvent, onFullTime }: Props) {
  const { t } = useTranslation();
  // The finished snapshot is fed back through onSnapshotUpdate; keeping the first one
  // stops that echo from re-creating the simulation and replaying the match.
  const [snapshot] = useState(initialSnapshot);
  const walls = useMemo(() => getWalls(), []);
  const nav = useMemo(() => new NavGrid(walls), [walls]);
  const [seed] = useState(randomSeed10Digits);
  const [running, setRunning] = useState(true);
  const [isSkipping, setIsSkipping] = useState(false);
  const [skipWarningOpen, setSkipWarningOpen] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [speed, setSpeed] = useState(4);
  const aiMode: LolSimV1AiMode = "hybrid";
  const { settings } = useSettingsStore();
  const simPolicy = useMemo<LolSimV1PolicyConfig>(() => ({
    hybridOpenTradeConfidenceHigh: settings.lol_hybrid_open_trade_confidence_high,
    hybridDisengageConfidenceLow: settings.lol_hybrid_disengage_confidence_low,
  }), [settings.lol_hybrid_disengage_confidence_low, settings.lol_hybrid_open_trade_confidence_high]);
  const [tick, setTick] = useState(0);
  const hudObjectiveCountersRef = useRef({ blueVoidgrubs: 0, redVoidgrubs: 0 });

  const championByPlayerId = useMemo<Record<string, string>>(() => {
    if (!championSelections) return {};
    return {
      ...championSelections.home,
      ...championSelections.away,
    };
  }, [championSelections]);
  const [championProfilesById, setChampionProfilesById] = useState<Record<string, ChampionCombatProfile>>({});
  const [championUltimatesById, setChampionUltimatesById] = useState<Record<string, LolChampionUltimateProfile>>({});
  // The simulation is built once, after the champion profile load settles (success or failure),
  // so a late load never rebuilds it mid-game.
  const [profilesReady, setProfilesReady] = useState(false);

  useEffect(() => {
    const updateMobileLayout = () => {
      const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
      const hasTouch = navigator.maxTouchPoints > 0;
      const isAndroid = /Android/i.test(navigator.userAgent);
      const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const looksLikePhoneScreen = Math.min(window.screen.width, window.screen.height) <= 900;
      const hasTightHeight = window.innerHeight <= 920;

      setIsMobileLayout(isAndroid || isIos || ((isCoarsePointer || hasTouch || looksLikePhoneScreen) && hasTightHeight));
    };

    updateMobileLayout();
    window.addEventListener("resize", updateMobileLayout);
    return () => window.removeEventListener("resize", updateMobileLayout);
  }, []);

  const runtimeModifierByChampionId = useMemo<Record<string, number>>(() => {
    const next: Record<string, number> = {};
    const hiddenMeta = gameState?.champion_patch?.hidden_meta ?? [];
    const masteryEntries = gameState?.champion_masteries ?? [];

    const masteryByPlayerChampion = new Map<string, number>();
    masteryEntries.forEach((entry) => {
      masteryByPlayerChampion.set(`${entry.player_id}:${normalizeKey(entry.champion_id)}`, Number(entry.mastery ?? 25));
    });

    const roleLabel = (role: string): "Top" | "Jungle" | "Mid" | "ADC" | "Support" => {
      const key = normalizeKey(role);
      if (key === "top") return "Top";
      if (key === "jungle") return "Jungle";
      if (key === "mid" || key === "middle") return "Mid";
      if (key === "adc" || key === "bot" || key === "bottom") return "ADC";
      return "Support";
    };

    const tierWeight: Record<string, number> = { S: 0.08, A: 0.04, B: 0, C: -0.03, D: -0.06 };
    const roleTierByChampion = new Map<string, string>();
    const bestTierByChampion = new Map<string, string>();
    const tierOrder: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

    hiddenMeta.forEach((entry) => {
      const championKey = normalizeKey(entry.champion_id);
      const tier = String(entry.tier ?? "B").toUpperCase();
      const role = roleLabel(entry.role);
      const roleKey = `${role}:${championKey}`;
      const previousRoleTier = roleTierByChampion.get(roleKey);
      if (!previousRoleTier || (tierOrder[tier] ?? 99) < (tierOrder[previousRoleTier] ?? 99)) {
        roleTierByChampion.set(roleKey, tier);
      }

      const previousBest = bestTierByChampion.get(championKey);
      if (!previousBest || (tierOrder[tier] ?? 99) < (tierOrder[previousBest] ?? 99)) {
        bestTierByChampion.set(championKey, tier);
      }
    });

    const roleByPlayerId = {
      ...(championSelections?.homeRoles ?? {}),
      ...(championSelections?.awayRoles ?? {}),
    };

    Object.entries(championByPlayerId).forEach(([playerId, championId]) => {
      if (!championId) return;
      const championKey = normalizeKey(championId);
      const mastery = masteryByPlayerChampion.get(`${playerId}:${championKey}`) ?? 25;
      const masteryDelta = ((mastery - 50) / 50) * 0.14;

      const rawRole = roleByPlayerId[playerId] ?? "MID";
      const mappedRole = rawRole === "TOP"
        ? "Top"
        : rawRole === "JUNGLE"
          ? "Jungle"
          : rawRole === "ADC"
            ? "ADC"
            : rawRole === "SUPPORT"
              ? "Support"
              : "Mid";
      const tier = resolveRoleTier(
        roleTierByChampion.get(`${mappedRole}:${championKey}`),
        bestTierByChampion.get(championKey),
        championPlaysRole(championId, rawRole === "TOP" || rawRole === "JUNGLE" || rawRole === "ADC" || rawRole === "SUPPORT" ? rawRole : "MID"),
      );
      const tierDelta = tierWeight[tier] ?? 0;
      const modifier = Math.max(0.82, Math.min(1.25, 1 + masteryDelta + tierDelta));

      // If same champion appears duplicated (rare), blend modifiers.
      if (next[championId] !== undefined) {
        next[championId] = (next[championId] + modifier) / 2;
      } else {
        next[championId] = modifier;
      }
    });

    return next;
  }, [championByPlayerId, championSelections?.awayRoles, championSelections?.homeRoles, gameState?.champion_masteries, gameState?.champion_patch?.hidden_meta]);

  useEffect(() => {
    let cancelled = false;

    const loadChampionProfiles = async () => {
      const pickedChampionIds = Array.from(new Set(Object.values(championByPlayerId).filter(Boolean)));
      if (pickedChampionIds.length === 0) {
        if (!cancelled) {
          setChampionProfilesById({});
          setChampionUltimatesById({});
          setProfilesReady(true);
        }
        return;
      }

      try {
        const kits = await loadChampionKits();
        if (!cancelled) {
          const { profiles, ultimates } = buildChampionProfiles(kits, pickedChampionIds, runtimeModifierByChampionId);
          setChampionProfilesById(profiles);
          setChampionUltimatesById(ultimates);
          setProfilesReady(true);
        }
      } catch {
        if (!cancelled) {
          setChampionProfilesById({});
          setChampionUltimatesById({});
          setProfilesReady(true);
        }
      }
    };

    void loadChampionProfiles();
    return () => {
      cancelled = true;
    };
  }, [championByPlayerId, runtimeModifierByChampionId]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<PrototypeSimulation | null>(null);
  const backendClientRef = useRef<LolSimV2Client | null>(null);
  const backendStateRef = useRef<LolSimV1RuntimeState | null>(null);
  const backendTickInFlightRef = useRef(false);
  const backendPendingDtRef = useRef(0);
  const goldDiffTimelineRef = useRef<Array<{ minute: number; diff: number }>>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const finishedRef = useRef(false);

  const withRuntimeSpeed = (state: MatchState | LolSimV1RuntimeState): LolSimV1RuntimeState => ({
    ...state,
    speed: "speed" in state ? state.speed : speed,
  });

  const currentState = (): LolSimV1RuntimeState | null => {
    if (USE_RUST_SIM_V2 && backendStateRef.current) return backendStateRef.current;
    return simRef.current ? withRuntimeSpeed(simRef.current.state) : null;
  };

  useEffect(() => {
    if (!profilesReady) return;
    const tsSim = new PrototypeSimulation(nav, snapshot, seed, championByPlayerId, championProfilesById);
    simRef.current = tsSim;
    backendClientRef.current = null;
    backendStateRef.current = null;
    backendTickInFlightRef.current = false;
    backendPendingDtRef.current = 0;
    goldDiffTimelineRef.current = [{ minute: 0, diff: 0 }];
    finishedRef.current = false;

    if (!USE_RUST_SIM_V2) return;

    const client = new LolSimV2Client();
    backendClientRef.current = client;
    let disposed = false;

    void client
      .init({
        seed,
        aiMode,
        policy: simPolicy,
        snapshot,
        championByPlayerId,
        championProfilesById,
        championUltimatesById,
        initialState: { ...tsSim.state, speed },
      })
      .then((response) => {
        if (disposed || backendClientRef.current !== client) return;
        backendStateRef.current = response.state;
      })
      .catch(() => {
        if (disposed || backendClientRef.current !== client) return;
        backendClientRef.current = null;
        backendStateRef.current = null;
        backendTickInFlightRef.current = false;
      });

    return () => {
      disposed = true;
      if (backendClientRef.current === client) {
        backendClientRef.current = null;
        backendStateRef.current = null;
        backendTickInFlightRef.current = false;
        backendPendingDtRef.current = 0;
      }
      void client.dispose().catch(() => undefined);
    };
  }, [aiMode, nav, seed, simPolicy, snapshot, championByPlayerId, championProfilesById, championUltimatesById, profilesReady]);

  useEffect(() => {
    const loop = (ts: number) => {
      const sim = simRef.current;
      const canvas = canvasRef.current;
      if (!sim || !canvas) return;

      if (!lastRef.current) lastRef.current = ts;
      const dt = Math.min(0.05, (ts - lastRef.current) / 1000);
      lastRef.current = ts;

      sim.setRunning(running);

      const backendClient = USE_RUST_SIM_V2 ? backendClientRef.current : null;
      if (isSkipping) {
        // While skip-to-end is running, avoid sending background tick requests.
        backendPendingDtRef.current = 0;
      } else if (backendClient && backendStateRef.current) {
        // Acumulador anti-tirones: si backend está ocupado, no perdemos tiempo simulado.
        backendPendingDtRef.current = Math.min(0.5, backendPendingDtRef.current + dt);
        if (!backendTickInFlightRef.current) {
          backendTickInFlightRef.current = true;
          const dtForBackend = Math.min(0.05, backendPendingDtRef.current);
          backendPendingDtRef.current = Math.max(0, backendPendingDtRef.current - dtForBackend);
          void backendClient
            .tick({ dtSec: dtForBackend, running, speed })
            .then((response) => {
              if (backendClientRef.current !== backendClient) return;
              backendStateRef.current = response.state;
            })
            .catch(() => {
              if (backendClientRef.current !== backendClient) return;
              backendClientRef.current = null;
              backendStateRef.current = null;
              backendPendingDtRef.current = 0;
            })
            .finally(() => {
              if (backendClientRef.current === backendClient) {
                backendTickInFlightRef.current = false;
              }
            });
        }
      } else {
        sim.tick(dt, speed);
      }

      const state = currentState();
      if (!state) return;

      const minute = Math.max(0, Math.floor((state.timeSec ?? 0) / 60));
      const diff = Math.round((state.stats?.blue?.gold ?? 0) - (state.stats?.red?.gold ?? 0));
      const goldTimeline = goldDiffTimelineRef.current;
      const lastGoldPoint = goldTimeline[goldTimeline.length - 1];
      if (!lastGoldPoint || lastGoldPoint.minute !== minute) {
        goldTimeline.push({ minute, diff });
      } else {
        lastGoldPoint.diff = diff;
      }

      const rect = canvas.getBoundingClientRect();
      const size = Math.max(320, Math.floor(Math.min(rect.width, rect.height)));
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
      }
      renderSimulation(canvas, state, walls, championByPlayerId);

      if (state.winner && !finishedRef.current) {
        finishedRef.current = true;
        const effectiveBlueTeamId = blueTeamId ?? snapshot.home_team.id;
        const homeIsBlue = snapshot.home_team.id === effectiveBlueTeamId;
        const homeWon = (homeIsBlue && state.winner === "blue") || (!homeIsBlue && state.winner === "red");
        const evt: MatchEvent = {
          minute: Math.floor(state.timeSec / 60),
          event_type: "NexusDestroyed",
          side: homeWon ? "Home" : "Away",
          zone: "Midfield",
          player_id: null,
          secondary_player_id: null,
        };
        onImportantEvent(evt);
        onSnapshotUpdate({
          ...snapshot,
          phase: "Finished",
          current_minute: Math.floor(state.timeSec / 60),
          home_score: homeWon ? 1 : 0,
          away_score: homeWon ? 0 : 1,
          events: mergeMatchEvents(snapshot.events, [
            ...mapRuntimeEventsToMatchEvents(state.events, effectiveBlueTeamId, snapshot.home_team.id),
            evt,
          ]),
        });
        const finalState = {
          ...state,
          goldDiffTimeline: [...goldDiffTimelineRef.current],
        };
        setTimeout(() => onFullTime(finalState, { source: "live" }), 400);
      }

      setTick((v) => v + 1);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = 0;
    };
  }, [championByPlayerId, isSkipping, onFullTime, onImportantEvent, onSnapshotUpdate, profilesReady, running, snapshot, speed, walls]);

  useEffect(() => {
    return () => {
      const client = backendClientRef.current;
      backendClientRef.current = null;
      backendStateRef.current = null;
      backendTickInFlightRef.current = false;
      backendPendingDtRef.current = 0;
      if (client) {
        void client.dispose().catch(() => undefined);
      }
    };
  }, []);

  const state = currentState();
  const dragon = state?.objectives?.dragon;
  const blueTag = teamTag(snapshot.home_team.name);
  const redTag = teamTag(snapshot.away_team.name);
  const blueKills = state?.stats?.blue?.kills ?? 0;
  const redKills = state?.stats?.red?.kills ?? 0;
  const blueGold = formatGoldCompact(state?.stats?.blue?.gold ?? 0);
  const redGold = formatGoldCompact(state?.stats?.red?.gold ?? 0);
  const blueTowers = state?.stats?.blue?.towers ?? 0;
  const redTowers = state?.stats?.red?.towers ?? 0;
  const blueDragons = state?.stats?.blue?.dragons ?? 0;
  const redDragons = state?.stats?.red?.dragons ?? 0;
  const blueBuffs = runtimeTeamBuffs(state, "blue");
  const redBuffs = runtimeTeamBuffs(state, "red");
  const blueVoidgrubsRaw = blueBuffs?.voidgrub_stacks ?? countVoidgrubsBySide(state?.events, "blue");
  const redVoidgrubsRaw = redBuffs?.voidgrub_stacks ?? countVoidgrubsBySide(state?.events, "red");
  const blueVoidgrubs = Math.max(hudObjectiveCountersRef.current.blueVoidgrubs, blueVoidgrubsRaw);
  const redVoidgrubs = Math.max(hudObjectiveCountersRef.current.redVoidgrubs, redVoidgrubsRaw);
  hudObjectiveCountersRef.current.blueVoidgrubs = blueVoidgrubs;
  hudObjectiveCountersRef.current.redVoidgrubs = redVoidgrubs;
  const clock = `${Math.floor((state?.timeSec ?? 0) / 60)}:${Math.floor((state?.timeSec ?? 0) % 60).toString().padStart(2, "0")}`;
  const blueBrand = teamBrand(snapshot.home_team.name, gameState?.teams);
  const redBrand = teamBrand(snapshot.away_team.name, gameState?.teams);
  const leagueLogo = gameState?.user_competition_id
    ? gameState.leagues.find((l) => l.competition_id === gameState.user_competition_id)?.logo
      ?? `/competitions-icons/${gameState.user_competition_id}.webp`
    : "/competitions-icons/lec.webp";
  const dragonIcon = dragonIconForKind(dragon?.currentKind);
  const blueDragonIcons = dragonKillIconsBySide(
    state?.events,
    "blue",
    blueDragons,
    blueBuffs?.dragon_history,
  );
  const redDragonIcons = dragonKillIconsBySide(
    state?.events,
    "red",
    redDragons,
    redBuffs?.dragon_history,
  );
  const championIconByRuntimeName = useMemo<Record<string, string>>(() => {
    const champions = state?.champions ?? [];
    const result: Record<string, string> = {};

    champions.forEach((champion) => {
      const runtimeChampionId = (champion as { championId?: string; champion_id?: string }).championId
        ?? (champion as { championId?: string; champion_id?: string }).champion_id
        ?? "";
      const mappedChampionId = championByPlayerId[champion.id] ?? championByPlayerId[champion.name] ?? "";
      const championId = runtimeChampionId || mappedChampionId;
      const iconUrl = championId
        ? championIconUrl(championId)
        : `/player-photos/${champion.id}.webp`;
      const byName = normalizeChampionLookupKey(champion.name);
      if (byName) result[byName] = iconUrl;
      const byId = normalizeChampionLookupKey(champion.id);
      if (byId) result[byId] = iconUrl;
    });

    return result;
  }, [state?.champions, championByPlayerId]);
  const leftEventFeed = useMemo(() => {
    const source = (state?.events ?? [])
      .filter((event) => event.type === "kill" || event.type === "dragon" || event.type === "baron" || event.type === "tower" || event.type === "nexus")
      .slice(-6)
      .reverse();

    const champions = state?.champions ?? [];

    return source.map((event, index) => {
      const minute = Math.max(0, Math.floor((event.t ?? 0) / 60));
      if (event.type === "kill") {
        const parsed = parseKillText(event.text ?? "");
        const mentions = championsMentionedInText(event.text ?? "", champions);
        const fallbackKillerLabel = mentions[0]?.name ?? "";
        const fallbackVictimLabel = mentions[1]?.name ?? "";
        const killerLabel = parsed?.killerName || fallbackKillerLabel;
        const victimLabel = parsed?.victimName || fallbackVictimLabel;
        const fallbackBlue = champions.find((champion) => champion.team === "blue");
        const fallbackRed = champions.find((champion) => champion.team === "red");
        const killerIcon = resolveChampionPortrait(killerLabel, champions, championIconByRuntimeName)
          ?? (fallbackBlue ? resolveChampionPortrait(fallbackBlue.name, champions, championIconByRuntimeName) : null);
        const victimIcon = resolveChampionPortrait(victimLabel, champions, championIconByRuntimeName)
          ?? (fallbackRed ? resolveChampionPortrait(fallbackRed.name, champions, championIconByRuntimeName) : null);
        const side = sideFromActorLabel(killerLabel, champions) ?? sideFromRuntimeText(event.text);

        return {
          key: `kill-${event.t}-${index}`,
          minute,
          type: event.type,
          side,
          text: event.text,
          killerLabel,
          victimLabel,
          killerIcon,
          victimIcon,
          objectiveIcon: null,
        };
      }

      return {
        key: `${event.type}-${event.t}-${index}`,
        minute,
        type: event.type,
        side: sideFromRuntimeText(event.text),
        text: event.text,
        killerLabel: "",
        victimLabel: "",
        killerIcon: null,
        victimIcon: null,
        objectiveIcon: objectiveIconForEvent(event),
      };
    });
  }, [state?.events, state?.champions, championIconByRuntimeName]);

  const handleReset = () => {
    const sim = simRef.current;
    if (!sim) return;

    const nextSeed = randomSeed10Digits();

    sim.reset(nextSeed);

    const backendClient = USE_RUST_SIM_V2 ? backendClientRef.current : null;
    if (backendClient && backendStateRef.current) {
      backendTickInFlightRef.current = false;
      void backendClient
        .reset({ seed: nextSeed, aiMode, policy: simPolicy, initialState: { ...sim.state, speed } })
        .then((response) => {
          if (backendClientRef.current !== backendClient) return;
          backendStateRef.current = response.state;
          setTick((v) => v + 1);
        })
        .catch(() => {
          if (backendClientRef.current !== backendClient) return;
          backendClientRef.current = null;
          backendStateRef.current = null;
        });
    }

    finishedRef.current = false;
    hudObjectiveCountersRef.current = { blueVoidgrubs: 0, redVoidgrubs: 0 };
    setRunning(true);
  };

  const handleSkipMatch = async () => {
    if (isSkipping) return;

    setSkipWarningOpen(false);
    setIsSkipping(true);
    setRunning(false);
    backendPendingDtRef.current = 0;
    backendTickInFlightRef.current = false;

    try {
      const stateNow = currentState();
      const predictiveState: LolSimV1RuntimeState = {
        timeSec: stateNow?.timeSec ?? 0,
        running: false,
        winner: stateNow?.winner ?? null,
        showWalls: false,
        champions: stateNow?.champions ?? [],
        minions: stateNow?.minions ?? [],
        structures: stateNow?.structures ?? [],
        objectives: stateNow?.objectives ?? createDefaultObjectivesState(),
        neutralTimers: stateNow?.neutralTimers ?? createEmptyNeutralTimersState(),
        stats: stateNow?.stats ?? {
          blue: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
          red: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
        },
        events: stateNow?.events ?? [],
        speed: stateNow?.speed ?? speed,
      };

      await new Promise((resolve) => setTimeout(resolve, 450));
      onFullTime(predictiveState, { source: "skip" });
    } catch (error) {
      console.error("[LolMatchLive] skip failed", error);
      setRunning(true);
    } finally {
      setIsSkipping(false);
    }
  };

  void tick;

  return (
    <div className="relative min-h-0 flex-1 overflow-auto scrollbar-v2 bg-[#050505] text-white">
      <div className="flex h-full w-full flex-col items-center justify-start px-[5%] pt-[2.5%]">
        <div className="map-container flex w-full flex-[0_0_auto] flex-col items-center justify-center">
          <div className="relative mb-2 w-full px-2 pb-6 sm:px-4 sm:pb-9">
            <style>{`
              @keyframes lolFeedSlideIn {
                0% { opacity: 0; transform: translateX(-16px) scale(0.98); }
                100% { opacity: 1; transform: translateX(0) scale(1); }
              }
              .lol-feed-entry {
                animation: lolFeedSlideIn 260ms ease-out both;
              }
            `}</style>
            <div className="relative flex h-[54px] items-center overflow-hidden border-t border-white/10 bg-gradient-to-r from-navy-950 via-black to-navy-950 shadow-[0_10px_30px_rgba(0,0,0,0.5)] sm:h-[62px]">
              <div className="absolute left-0 h-full w-1 bg-[#00fcdb] shadow-[2px_0_10px_rgba(0,252,219,0.3)]" />
              <div className="absolute right-0 h-full w-1 bg-[#ff4e00] shadow-[-2px_0_10px_rgba(255,78,0,0.3)]" />

              <div className="flex w-[38%] items-center px-4">
                <div className="mx-3 flex h-[42px] w-[42px] items-center justify-center border border-white/20 bg-white/5">
                  {blueBrand.logo ? <img src={blueBrand.logo} className="h-9 w-9 object-contain" alt={`${snapshot.home_team.name} logo`} loading="lazy" /> : null}
                </div>
                <div className="flex flex-col leading-[0.9]">
                  <span className="text-xl font-black tracking-[-1px] text-primary-400 sm:text-4xl">{blueBrand.tag || blueTag}</span>
                  <span className="text-sm font-bold text-white/55">{t("match.live")}</span>
                </div>
                <div className="ml-4 flex items-center gap-2 text-base font-bold italic text-white sm:ml-7 sm:text-2xl">
                  <img src={ICON_TOWER} className="h-5 w-5 object-contain opacity-90" alt={t("match.liveA11y.towerIcon")} loading="lazy" />
                  <span>{blueTowers}</span>
                  <img src={ICON_GOLD} className="ml-2 h-5 w-5 object-contain" alt={t("match.liveA11y.goldIcon")} loading="lazy" />
                  <span>{blueGold}</span>
                </div>
              </div>

              <div className="flex w-[24%] items-center justify-center gap-4">
                <span className="text-4xl font-black italic leading-none text-white sm:text-5xl">{blueKills}</span>
                <img src={leagueLogo} className="h-7 w-7 object-contain opacity-95" alt={t("match.liveA11y.lecLogo")} loading="lazy" />
                <span className="text-4xl font-black italic leading-none text-white sm:text-5xl">{redKills}</span>
              </div>

              <div className="flex w-[38%] items-center justify-end px-4 text-right">
                <div className="mr-4 flex items-center gap-2 text-base font-bold italic text-white sm:mr-5 sm:text-2xl">
                  <span>{redGold}</span>
                  <img src={ICON_GOLD} className="h-5 w-5 object-contain" alt={t("match.liveA11y.goldIcon")} loading="lazy" />
                  <span className="ml-2">{redTowers}</span>
                  <img src={ICON_TOWER} className="h-5 w-5 object-contain opacity-90" alt={t("match.liveA11y.towerIcon")} loading="lazy" />
                </div>
                <div className="flex flex-col leading-[0.9]">
                  <span className="text-xl font-black tracking-[-1px] text-accent-600 sm:text-4xl">{redBrand.tag || redTag}</span>
                  <span className="text-sm font-bold text-white/55">{t("match.live")}</span>
                </div>
                <div className="ml-3 flex h-[42px] w-[42px] items-center justify-center border border-white/20 bg-white/5">
                  {redBrand.logo ? <img src={redBrand.logo} className="h-9 w-9 object-contain" alt={`${snapshot.away_team.name} logo`} loading="lazy" /> : null}
                </div>
              </div>
            </div>

            <div
              className="absolute left-1/2 top-[54px] flex h-[34px] -translate-x-1/2 items-center justify-between border-t border-navy-700 bg-black px-[26px] sm:top-[62px] sm:h-[38px] sm:px-[60px]"
              style={{ clipPath: "polygon(0 0, 100% 0, 93% 100%, 7% 100%)", width: "min(92%, 900px)" }}
            >
              <div className="flex items-center gap-2">
                {blueDragonIcons.length > 0
                  ? blueDragonIcons.map((iconSrc, idx) => (
                    <img key={`blue-dragon-${idx}`} src={iconSrc} className="h-[22px] w-[22px] object-contain" alt={t("match.liveA11y.dragonIcon")} loading="lazy" />
                  ))
                  : <img src={dragonIcon} className="h-[22px] w-[22px] object-contain opacity-35" alt={t("match.liveA11y.dragonIcon")} loading="lazy" />}
                <div className="flex items-center gap-1 text-xl font-bold text-white/70">
                  <img src={ICON_VOIDGRUB} className="h-4 w-4 object-contain" alt={t("match.liveA11y.voidgrubIcon")} loading="lazy" />
                  <span>{blueVoidgrubs}</span>
                </div>
              </div>

              <div className="text-2xl font-black italic tracking-[1px] text-white sm:text-[2rem]">{clock}</div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xl font-bold text-white/70">
                  <span>{redVoidgrubs}</span>
                  <img src={ICON_VOIDGRUB} className="h-4 w-4 object-contain" alt={t("match.liveA11y.voidgrubIcon")} loading="lazy" />
                </div>
                {redDragonIcons.length > 0
                  ? redDragonIcons.map((iconSrc, idx) => (
                    <img key={`red-dragon-${idx}`} src={iconSrc} className="h-[22px] w-[22px] object-contain" alt={t("match.liveA11y.dragonIcon")} loading="lazy" />
                  ))
                  : <img src={dragonIcon} className="h-[22px] w-[22px] object-contain opacity-35" alt={t("match.liveA11y.dragonIcon")} loading="lazy" />}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col items-center gap-3 px-2 lg:flex-row lg:items-stretch lg:justify-center">
            {!isMobileLayout ? (
              <div className="w-full max-w-[260px] lg:w-[246px]">
                <div className="flex flex-col gap-[7px]">
                  {leftEventFeed.length > 0 ? leftEventFeed.map((entry) => (
                    <div
                      key={entry.key}
                      className={`lol-feed-entry rounded-[4px] border bg-black/75 px-[8px] py-[6px] shadow-[0_8px_20px_rgba(0,0,0,0.45)] ${entry.side === "red" ? "border-red-500/40" : "border-cyan-500/30"}`}
                    >
                      <div className={`mb-[4px] h-[1px] w-full bg-gradient-to-r from-transparent ${entry.side === "red" ? "via-red-300/70" : "via-cyan-300/70"} to-transparent`} />
                      {entry.type === "kill" ? (
                        <div className="flex items-center gap-[7px]">
                          <div className="h-[36px] w-[36px] overflow-hidden rounded-[3px] border border-white/25 bg-black/45">
                            {entry.killerIcon
                              ? <img src={entry.killerIcon} className="h-full w-full object-cover" alt={t("match.liveA11y.killerIcon")} loading="lazy" />
                              : <div className={`flex h-full w-full items-center justify-center text-xs font-bold ${entry.side === "red" ? "bg-[#22151a] text-red-200" : "bg-[#151a26] text-cyan-200"}`}>{actorInitials(entry.killerLabel, "K")}</div>}
                          </div>
                          <div className={`flex h-[26px] w-[26px] items-center justify-center rounded-[3px] border text-sm ${entry.side === "red" ? "border-red-400/40 bg-red-500/10 text-red-200" : "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"}`}>⚔</div>
                          <div className="h-[36px] w-[36px] overflow-hidden rounded-[3px] border border-white/25 bg-black/45">
                            {entry.victimIcon
                              ? <img src={entry.victimIcon} className="h-full w-full object-cover" alt={t("match.liveA11y.victimIcon")} loading="lazy" />
                              : <div className={`flex h-full w-full items-center justify-center text-xs font-bold ${entry.side === "red" ? "bg-[#22151a] text-red-200" : "bg-[#151a26] text-cyan-200"}`}>{actorInitials(entry.victimLabel, "V")}</div>}
                          </div>
                          <span className="ml-auto text-xs font-bold text-white/75">{entry.minute}'</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-[7px]">
                          <div className="h-[36px] w-[36px] overflow-hidden rounded-[3px] border border-white/25 bg-black/45 p-[4px]">
                            {entry.objectiveIcon
                              ? <img src={entry.objectiveIcon} className="h-full w-full object-contain" alt={entry.type} loading="lazy" />
                              : null}
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className={`truncate text-2xs font-semibold uppercase tracking-[0.5px] ${entry.side === "red" ? "text-red-200" : "text-cyan-200"}`}>{entry.type}</span>
                            <span className="truncate text-2xs text-white/75">{entry.text}</span>
                          </div>
                          <span className="text-xs font-bold text-white/75">{entry.minute}'</span>
                        </div>
                      )}
                      <div className={`mt-[5px] h-[2px] w-full bg-gradient-to-r ${entry.side === "red" ? "from-red-500/40 via-red-300 to-red-500/40" : "from-cyan-500/40 via-cyan-300 to-cyan-500/40"}`} />
                    </div>
                  )) : (
                    <div className="rounded-[4px] border border-cyan-500/30 bg-black/75 px-2 py-1 text-2xs text-white/65">
                      {t("match.waitingFirstSkirmish")}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="relative flex min-w-0 flex-1 items-center justify-center">
              <canvas
                ref={canvasRef}
                className="h-[clamp(220px,44vh,680px)] w-auto max-w-full object-contain sm:h-[clamp(260px,50vh,720px)]"
              />
            </div>

            <div className="w-full max-w-[260px] lg:w-[246px]">
              <div className="rounded border border-cyan-500/30 bg-black/70 p-2">
                <div className="mb-2 text-2xs font-semibold uppercase tracking-[0.6px] text-cyan-200/90">
                  {t("match.liveControls")}
                </div>
                <div className="grid grid-cols-2 gap-1 text-2xs">
                  <button className="rounded border border-cyan-500/30 bg-black/60 px-2 py-1 text-white/90" onClick={() => setRunning((v) => !v)}>
                    {running ? t("match.pause") : t("match.play")}
                  </button>

                  <button className="col-span-2 rounded border border-cyan-500/30 bg-black/60 px-2 py-1 text-white/90" onClick={handleReset}>
                    {t("match.reset")}
                  </button>
                  {SPEEDS.map((s) => (
                    <button
                      key={s.id}
                      className={`rounded border px-2 py-1 ${speed === s.value ? "border-cyan-300 bg-cyan-500/20 text-cyan-100" : "border-cyan-500/30 bg-black/60 text-white/80"}`}
                      onClick={() => setSpeed(s.value)}
                    >
                      {s.id}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="hud-board w-full flex-1 flex flex-col">
          <div className="flex-1 overflow-hidden">
            <LecLowerThirdPanel champions={state?.champions ?? []} championByPlayerId={championByPlayerId} timeSec={state?.timeSec ?? 0} />
          </div>
          <div className="pb-2" />
        </div>
      </div>

      {skipWarningOpen && !isSkipping ? (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55">
          <div className="w-[min(92vw,520px)] rounded border border-red-500/45 bg-[linear-gradient(180deg,rgba(44,8,10,0.95)_0%,rgba(24,5,6,0.95)_100%)] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.6)]">
            <h3 className="text-sm font-bold uppercase tracking-[0.5px] text-red-200">
              {t("match.skipWarningTitle")}
            </h3>
            <p className="mt-2 text-sm text-red-100/90">
              {t(
                "match.skipWarningBody",
                "Skip Match now re-simulates from minute 0. You will lose all progress from this live match.",
              )}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded border border-white/20 bg-black/45 px-3 py-1.5 text-xs text-white/85"
                onClick={() => setSkipWarningOpen(false)}
              >
                {t("match.cancel")}
              </button>
              <button
                className="rounded border border-red-400/50 bg-red-600/25 px-3 py-1.5 text-xs font-semibold text-red-100"
                onClick={() => {
                  void handleSkipMatch();
                }}
              >
                {t("match.resimFromZero")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSkipping ? (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
          <div className="flex flex-col items-center rounded border border-cyan-500/40 bg-black/75 px-6 py-4 shadow-[0_14px_35px_rgba(0,0,0,0.55)]">
            <span className="text-base font-semibold tracking-[0.4px] text-cyan-100">
              {t("match.clearingBattlefield")}
            </span>
            <div className="mt-3 h-8 w-8 animate-spin rounded-full border-2 border-cyan-300/35 border-t-cyan-200" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
