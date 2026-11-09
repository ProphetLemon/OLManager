import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { FixtureData, GameStateData } from "@/store/gameStore";
import { getFixtureDisplayLabel } from "@/lib/common/helpers";
import { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import PreMatchLineup, {
  getPositionOvr,
} from "@/ui-v2/_legacy/components/match/PreMatchLineup";
import MatchScreenLayout from "@/ui-v2/_legacy/components/match/MatchScreenLayout";
import { ChevronRight } from "lucide-react";
import OpponentIntelCard from "@/ui-v2/_legacy/components/match/OpponentIntelCard";
import { buildOpponentIntel } from "@/ui-v2/_legacy/components/match/opponentIntelService";
import {
  MAX_IMPORTS_IN_STARTING_FIVE,
  orderSwapsImportsFirst,
  parseImportLimitError,
  pickBestFive,
  wouldExceedImportLimit,
} from "@/lib/squad/imports";
import championsSeed from "../../../../../assets/simulation/champions.json";

interface PreMatchSetupProps {
  snapshot: MatchSnapshot;
  gameState: GameStateData;
  currentFixture?: FixtureData | null;
  userSide: "Home" | "Away";
  onStart: () => void;
  onCancel: () => void;
  onUpdateSnapshot: (snap: MatchSnapshot) => void;
}

export default function PreMatchSetup({
  snapshot,
  gameState,
  currentFixture,
  userSide,
  onStart,
  onCancel,
  onUpdateSnapshot,
}: PreMatchSetupProps) {
  const { t } = useTranslation();
  const [selectedStarterId, setSelectedStarterId] = useState<string | null>(
    null,
  );
  const [isAutoSelecting, setIsAutoSelecting] = useState(false);

  const userTeam =
    userSide === "Home" ? snapshot.home_team : snapshot.away_team;
  const oppTeam =
    userSide === "Home" ? snapshot.away_team : snapshot.home_team;

  const homeTeamColor =
    gameState.teams.find((t) => t.id === snapshot.home_team.id)?.colors
      ?.primary || "#10b981";
  const awayTeamColor =
    gameState.teams.find((t) => t.id === snapshot.away_team.id)?.colors
      ?.primary || "#6366f1";
  const fixtureLabel = currentFixture
    ? getFixtureDisplayLabel(t, currentFixture)
    : t("match.matchDay");
  const homeTeamData = gameState.teams.find((t) => t.id === snapshot.home_team.id);
  const awayTeamData = gameState.teams.find((t) => t.id === snapshot.away_team.id);
  const homeLogo = homeTeamData?.logo_url ?? null;
  const awayLogo = awayTeamData?.logo_url ?? null;

  // Use snapshot bench data (updated after swaps)
  const userBench =
    userSide === "Home" ? snapshot.home_bench || [] : snapshot.away_bench || [];

  const opponentIntel = useMemo(
    () => {
      const teamCatalog: Array<{ id: string; name: string }> = [];
      const rosteredSeeds: Array<{ ign: string; teamId: string; role: string; champions: Array<Array<string | number>> }> = [];
      const freeAgentSeeds: Array<{ ign: string; teamId: string; role: string; champions: Array<Array<string | number>> }> = [];
      const playerCatalog = [...rosteredSeeds, ...freeAgentSeeds];
      const rolesMap = ((championsSeed as { data?: { roles?: Record<string, string[]> } }).data?.roles ?? {});
      const championCatalog = Object.entries(rolesMap).map(([name, roleHints]) => ({
        id: String(name).replace(/[^A-Za-z0-9]/g, ""),
        name,
        roleHints,
      }));

      return buildOpponentIntel({
        gameState,
        opponentTeamName: oppTeam.name,
        opponentPlayers: oppTeam.players.map((player) => ({ id: player.id, name: player.name })),
        teamSeeds: teamCatalog,
        playerSeeds: playerCatalog,
        championSeeds: championCatalog,
      });
    },
    [gameState, oppTeam.name, oppTeam.players],
  );
  console.info("[PreMatchSetup] render", {
    awayTeam: snapshot.away_team.name,
    benchCount: (snapshot.home_bench || []).length,
    homeTeam: snapshot.home_team.name,
    phase: snapshot.phase,
    draftStrategy: userTeam.draft_strategy,
    selectedStarterId,
    startingPlayerCount: userTeam.players.length,
    userSide,
    userTeam: userTeam.name,
  });

  const [importNotice, setImportNotice] = useState<string | null>(null);

  const importRefusal = (count: number) =>
    t("squad.tooManyImports", { count, max: MAX_IMPORTS_IN_STARTING_FIVE });

  const handleSwap = async (benchPlayerId: string) => {
    if (!selectedStarterId) return;
    const incoming = userBench.find((p) => p.id === benchPlayerId);
    if (incoming && wouldExceedImportLimit(userTeam.players, selectedStarterId, incoming)) {
      setImportNotice(importRefusal(MAX_IMPORTS_IN_STARTING_FIVE + 1));
      setSelectedStarterId(null);
      return;
    }
    setImportNotice(null);
    try {
      const snap = await invoke<MatchSnapshot>("apply_match_command", {
        command: {
          PreMatchSwap: {
            side: userSide,
            player_off_id: selectedStarterId,
            player_on_id: benchPlayerId,
          },
        },
      });
      onUpdateSnapshot(snap);
    } catch (err) {
      const refusal = parseImportLimitError(err);
      if (refusal) setImportNotice(importRefusal(refusal.count));
      console.error("Pre-match swap failed:", err);
    }
    setSelectedStarterId(null);
  };

  const handleAutoSelect = async () => {
    setIsAutoSelecting(true);
    try {
      const pool = [...userTeam.players, ...userBench];
      // Best five by rating and condition that holds at most two imports.
      const ideal = pickBestFive(
        pool,
        (p) => getPositionOvr(p) * (p.condition / 100),
      );
      // Swaps that remove imports run first so no step goes over the limit.
      const swaps = orderSwapsImportsFirst(userTeam.players, ideal);

      setImportNotice(null);
      let snap: MatchSnapshot | null = null;
      for (const swap of swaps) {
        snap = await invoke<MatchSnapshot>("apply_match_command", {
          command: {
            PreMatchSwap: {
              side: userSide,
              player_off_id: swap.off,
              player_on_id: swap.on.id,
            },
          },
        });
      }
      if (snap) onUpdateSnapshot(snap);
    } catch (err) {
      console.error("Auto-select failed:", err);
    } finally {
      setIsAutoSelecting(false);
      setSelectedStarterId(null);
    }
  };

  return (
    <MatchScreenLayout
      headerClassName="bg-linear-to-r from-muted via-card to-muted"
      headerContentClassName="max-w-5xl py-6"
      contentClassName="overflow-auto scrollbar-v2 bg-background"
      header={
        <>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center font-heading font-bold text-lg"
                style={{
                  backgroundColor: homeTeamColor + "30",
                  borderColor: homeTeamColor,
                  borderWidth: 2,
                }}
              >
                {homeLogo ? (
                  <img
                    src={homeLogo}
                    alt={snapshot.home_team.name}
                    className="w-10 h-10 object-contain"
                    loading="lazy"
                  />
                ) : (
                  snapshot.home_team.name.substring(0, 3).toUpperCase()
                )}
              </div>
              <div>
                <p className="font-heading font-bold text-lg text-foreground">
                  {snapshot.home_team.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("match.home")} · {t("match.lineup")} {snapshot.home_team.players.length}/5
                </p>
              </div>
            </div>

            <div className="text-center">
              <p className="text-xs font-heading uppercase tracking-widest text-primary mb-1">
                {fixtureLabel}
              </p>
              <p className="text-3xl font-heading font-bold text-muted-foreground">
                VS
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-heading font-bold text-lg text-foreground">
                  {snapshot.away_team.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("match.away")} · {t("match.lineup")} {snapshot.away_team.players.length}/5
                </p>
              </div>
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center font-heading font-bold text-lg"
                style={{
                  backgroundColor: awayTeamColor + "30",
                  borderColor: awayTeamColor,
                  borderWidth: 2,
                }}
              >
                {awayLogo ? (
                  <img
                    src={awayLogo}
                    alt={snapshot.away_team.name}
                    className="w-10 h-10 object-contain"
                    loading="lazy"
                  />
                ) : (
                  snapshot.away_team.name.substring(0, 3).toUpperCase()
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-3 mt-2">
            <button
              onClick={onCancel}
              className="flex items-center gap-2 px-6 py-3.5 bg-red-500/10 hover:bg-red-500/20 rounded-xl font-heading font-bold uppercase tracking-wider text-sm text-red-400 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={onStart}
              className="flex items-center gap-3 px-10 py-3.5 bg-primary hover:bg-primary/90 rounded-xl font-heading font-bold uppercase tracking-wider text-sm text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {t("match.startMatch")}
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </>
      }
    >
      <div className="w-[92%] max-w-[2000px] mx-auto px-6 py-6 flex flex-col gap-6">
        <PreMatchLineup
          homeTeam={snapshot.home_team}
          homeBench={snapshot.home_bench || []}
          awayTeam={snapshot.away_team}
          awayBench={snapshot.away_bench || []}
          homeTeamColor={homeTeamColor}
          awayTeamColor={awayTeamColor}
          userSide={userSide}
          selectedStarterId={selectedStarterId}
          isAutoSelecting={isAutoSelecting}
          onSelectStarter={setSelectedStarterId}
          onSwap={handleSwap}
          onAutoSelect={handleAutoSelect}
          importNotice={importNotice}
        />
        <OpponentIntelCard intel={opponentIntel} />
      </div>
    </MatchScreenLayout>
  );
}




