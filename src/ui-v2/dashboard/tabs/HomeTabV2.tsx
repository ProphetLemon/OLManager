import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { GameStateData, PlayerData } from "@/store/gameStore";
import { resolveActiveLineupIds } from "@/store/types";
import { useSettingsStore } from "@/store/settingsStore";
import type { BlockerData } from "@/services/advanceTimeService";
import type { DashboardAlert } from "@/lib/dashboard/helpers";
import type { DashboardNavigateContext } from "@/lib/dashboard/profileNavigation";
import { buildCallItems, type CallItem } from "@/lib/dashboard/needsYourCall";
import { getScoreboardData } from "@/lib/home/scoreboard";
import { getStandingsPanelData } from "@/lib/home/standings";
import { buildActiveLineupIds } from "@/lib/squad/helpers";
import { resolveMessage } from "@/lib/i18n/backendI18n";

import { ScoreboardHero } from "./home/ScoreboardHero";
import { NeedsYourCallPanel } from "./home/NeedsYourCallPanel";
import { InboxPanel, type InboxPanelMessage } from "./home/InboxPanel";
import { StandingsPanel } from "./home/StandingsPanel";

interface Props {
  gameState: GameStateData;
  onNavigate?: (tab: string, context?: DashboardNavigateContext) => void;
  onSelectPlayer?: (id: string, options?: { openRenewal?: boolean }) => void;
  alerts?: DashboardAlert[];
  blockers?: BlockerData[];
  canContinueAnyway?: boolean;
  unreadCount?: number;
}

const INBOX_ROWS = 3;
const NO_ALERTS: DashboardAlert[] = [];
const NO_BLOCKERS: BlockerData[] = [];

/** Backend priorities are capitalised ("High"); compare case-insensitively. */
function isUrgent(priority: string | undefined): boolean {
  return (priority ?? "").toLowerCase() === "high";
}

/**
 * Home: the next-match scoreboard on top, then what needs a decision and the inbox
 * beside the league table. Panels reflow through container queries, so the layout
 * follows the content area rather than the window.
 */
export function HomeTabV2({
  gameState,
  onNavigate,
  onSelectPlayer,
  alerts = NO_ALERTS,
  blockers = NO_BLOCKERS,
  canContinueAnyway = false,
  unreadCount = 0,
}: Props) {
  const { t } = useTranslation();
  const highContrast = useSettingsStore((s) => s.settings.high_contrast);

  const scoreboard = useMemo(
    () => getScoreboardData(gameState, { highContrast: Boolean(highContrast) }),
    [gameState, highContrast],
  );
  const standings = useMemo(() => getStandingsPanelData(gameState), [gameState]);

  const startingFive = useMemo<PlayerData[]>(() => {
    const myTeam = gameState.teams.find((team) => team.id === gameState.manager.team_id);
    if (!myTeam) return [];
    const roster = gameState.players.filter((player) => player.team_id === myTeam.id);
    const byId = new Map(roster.map((player) => [player.id, player]));
    return buildActiveLineupIds(roster, resolveActiveLineupIds(myTeam)).flatMap((id) => {
      const player = byId.get(id);
      return player ? [player] : [];
    });
  }, [gameState.teams, gameState.players, gameState.manager.team_id]);

  const calls = useMemo(
    () =>
      buildCallItems({
        alerts,
        blockers,
        canContinueAnyway,
        startingFive,
        currentDate: gameState.clock?.current_date ?? "",
        t,
      }),
    [alerts, blockers, canContinueAnyway, startingFive, gameState.clock?.current_date, t],
  );

  const inboxMessages = useMemo<InboxPanelMessage[]>(
    () =>
      [...(gameState.messages ?? [])]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, INBOX_ROWS)
        .map(resolveMessage)
        .map((message) => ({
          id: message.id,
          subject: message.subject,
          sender: message.sender,
          date: message.date,
          category: message.category,
          categoryLabel: `inbox.categories.${message.category}`,
          unread: !message.read,
          urgent: isUrgent(message.priority),
        })),
    [gameState.messages],
  );

  const handleAct = (item: CallItem) => {
    const playerId = item.target.context?.playerId;
    if (item.kind === "contract" && typeof playerId === "string" && onSelectPlayer) {
      onSelectPlayer(playerId, { openRenewal: true });
      return;
    }
    onNavigate?.(item.target.tab, item.target.context as DashboardNavigateContext | undefined);
  };

  return (
    <div data-slot="home" className="@container flex flex-col gap-4 p-4">
      <ScoreboardHero
        data={scoreboard}
        onOpenSchedule={() => onNavigate?.("Schedule")}
        onOpenSquad={() => onNavigate?.("Squad")}
      />

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <NeedsYourCallPanel
            items={calls.items}
            total={calls.total}
            hiddenContracts={calls.hiddenContracts}
            onAct={handleAct}
          />
          <InboxPanel
            messages={inboxMessages}
            unreadCount={unreadCount}
            onOpen={(messageId) =>
              onNavigate?.("Inbox", messageId ? { messageId } : undefined)
            }
          />
        </div>
        {standings ? (
          <div className="min-w-0">
            <StandingsPanel data={standings} onOpenTeams={() => onNavigate?.("Teams")} />
          </div>
        ) : (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t("onAir.home.standingsEmpty", { defaultValue: "No standings yet" })}
          </p>
        )}
      </div>
    </div>
  );
}
