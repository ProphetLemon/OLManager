import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { championDisplayName } from "@/lib/champions/championNames";
import { endSummary } from "@/lib/match/live/endSummary";
import { buildFightBoard } from "@/lib/match/live/fightBoard";
import { pitViews } from "@/lib/match/live/objectivesView";
import { opposingChampion, type CardChampion } from "@/lib/match/live/playerCardView";
import { buildSpotlight, type SpotlightPit } from "@/lib/match/live/spotlight";
import { teamIdentity } from "@/lib/match/live/teamIdentity";
import type { TeamSide } from "@/lib/match/live/mapGeometry";
import type { GameStateData } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import { mapRuntimeEventsToMatchEvents, mergeMatchEvents } from "@/ui-v2/_legacy/components/match/matchRuntimeEvents";
import FloatingBugButton from "@/ui-v2/_legacy/components/dashboard/FloatingBugButton";
import { useItemNames } from "@/ui-v2/_legacy/components/match/itemNames";
import {
  createDefaultObjectivesState,
  createEmptyNeutralTimersState,
  type LolSimV1PolicyConfig,
  type LolSimV1RuntimeState,
} from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { MatchEvent, MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import { ArenaMap } from "./live/ArenaMap";
import { ChampionLayer } from "./live/ChampionLayer";
import { ContactLayer } from "./live/ContactLayer";
import { EndPanel } from "./live/EndPanel";
import { EventTicker } from "./live/EventTicker";
import { FightBoard, FIGHT_BOARD_ID } from "./live/FightBoard";
import { LivePlayerCard } from "./live/LivePlayerCard";
import { MapLegend } from "./live/MapLegend";
import { MatchControls } from "./live/MatchControls";
import { MinionCanvas } from "./live/MinionCanvas";
import { PitMarkers } from "./live/PitMarkers";
import { ScoreBar, type ScoreStatus } from "./live/ScoreBar";
import { SpotlightCaption } from "./live/SpotlightCaption";
import { StructureLayer } from "./live/StructureLayer";
import { TowerFireLayer } from "./live/TowerFireLayer";
import { useChampionProfiles, type ChampionSelectionByPlayer } from "./live/useChampionProfiles";
import { useContactView } from "./live/useContactView";
import { useLiveSession } from "./live/useLiveSession";
import "./live/liveMatch.css";

export type { ChampionSelectionByPlayer } from "./live/useChampionProfiles";

/** The same props as the screen this one replaces, so the match flow does not change. */
export interface LiveMatchV2Props {
  snapshot: MatchSnapshot;
  gameState: GameStateData | null;
  blueTeamId?: string;
  championSelections?: ChampionSelectionByPlayer | null;
  onSnapshotUpdate: (snap: MatchSnapshot) => void;
  onImportantEvent: (evt: MatchEvent) => void;
  onFullTime: (finalState: LolSimV1RuntimeState, meta?: { source: "live" | "skip" }) => void;
}

/** Top to bottom, as the lanes are read. */
const ROLE_ORDER = ["TOP", "JGL", "MID", "ADC", "SUP"] as const;
const roleRank = (role: string): number => {
  const rank = ROLE_ORDER.indexOf(role as (typeof ROLE_ORDER)[number]);
  return rank === -1 ? ROLE_ORDER.length : rank;
};

/** What the panels read before the engine has answered once: a match at minute 0 with nobody on it. */
const EMPTY_STATE: LolSimV1RuntimeState = {
  timeSec: 0,
  running: true,
  winner: null,
  showWalls: false,
  champions: [],
  minions: [],
  structures: [],
  objectives: createDefaultObjectivesState(),
  neutralTimers: createEmptyNeutralTimersState(),
  stats: {
    blue: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
    red: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
  },
  events: [],
  speed: 4,
};

/**
 * The watched match. It wires the session, the champion profiles and the layers of the map to
 * the panels around it. Nothing here runs per animation frame: React renders when the session
 * commits (at most four times a second, and at once on a kill, an event or a pause), and the
 * markers, the links and the clock move on their own from the frame bus.
 *
 * The layout is plain CSS (see liveMatch.css). The map comes first in the source, then the
 * feed, the controls and the two teams' cards, so a phone reads in the order a person would.
 * Where the cards sit beside the map the page never scrolls: a card column that needs more room
 * than the window leaves scrolls on its own.
 * At the end the result waits behind a Continue button; only then does the match move on.
 */
export default function LiveMatchV2({
  gameState,
  snapshot: initialSnapshot,
  blueTeamId,
  championSelections,
  onSnapshotUpdate,
  onImportantEvent,
  onFullTime,
}: LiveMatchV2Props) {
  const { t } = useTranslation();
  // The finished snapshot comes back through onSnapshotUpdate; keeping the first one stops that
  // echo from reading as a different match.
  const [snapshot] = useState(initialSnapshot);
  const { settings } = useSettingsStore();
  const policy = useMemo<LolSimV1PolicyConfig>(
    () => ({
      hybridOpenTradeConfidenceHigh: settings.lol_hybrid_open_trade_confidence_high,
      hybridDisengageConfidenceLow: settings.lol_hybrid_disengage_confidence_low,
    }),
    [settings.lol_hybrid_disengage_confidence_low, settings.lol_hybrid_open_trade_confidence_high],
  );

  const profiles = useChampionProfiles(gameState, championSelections);
  const session = useLiveSession({
    snapshot,
    profilesReady: profiles.profilesReady,
    championByPlayerId: profiles.championByPlayerId,
    championProfilesById: profiles.championProfilesById,
    championUltimatesById: profiles.championUltimatesById,
    policy,
  });
  const { view, bus } = session;
  const state = view.state ?? EMPTY_STATE;
  const { contacts, beams } = useContactView(view.state);
  const itemNames = useItemNames();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skipFailed, setSkipFailed] = useState(false);
  const toggleSelected = useCallback((id: string) => setSelectedId((current) => (current === id ? null : id)), []);

  // ── Who is who ────────────────────────────────────────────────────────
  const blue = useMemo(() => teamIdentity(snapshot.home_team.name, gameState?.teams), [snapshot.home_team.name, gameState?.teams]);
  const red = useMemo(() => teamIdentity(snapshot.away_team.name, gameState?.teams), [snapshot.away_team.name, gameState?.teams]);
  const managerTeamId = gameState?.manager?.team_id ?? null;
  const userSide: TeamSide | null =
    managerTeamId === null ? null : managerTeamId === snapshot.home_team.id ? "blue" : managerTeamId === snapshot.away_team.id ? "red" : null;

  // ── The finish ────────────────────────────────────────────────────────
  // The winner is handed on once, whether the match was watched to its end or skipped to it.
  // The result screen waits for Continue.
  const finishedRef = useRef(false);
  const winner = view.winner;
  const finishedState = winner ? view.state : null;
  useEffect(() => {
    if (!winner || !finishedState) {
      finishedRef.current = false;
      return;
    }
    if (finishedRef.current) return;
    finishedRef.current = true;
    const effectiveBlueTeamId = blueTeamId ?? snapshot.home_team.id;
    const homeIsBlue = snapshot.home_team.id === effectiveBlueTeamId;
    const homeWon = (homeIsBlue && winner === "blue") || (!homeIsBlue && winner === "red");
    const minute = Math.floor(finishedState.timeSec / 60);
    const evt: MatchEvent = {
      minute,
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
      current_minute: minute,
      home_score: homeWon ? 1 : 0,
      away_score: homeWon ? 0 : 1,
      events: mergeMatchEvents(snapshot.events, [
        ...mapRuntimeEventsToMatchEvents(finishedState.events, effectiveBlueTeamId, snapshot.home_team.id),
        evt,
      ]),
    });
  }, [blueTeamId, finishedState, onImportantEvent, onSnapshotUpdate, snapshot, winner]);

  const summary = useMemo(() => endSummary(finishedState, userSide), [finishedState, userSide]);
  const handleContinue = useCallback(() => {
    if (!finishedState) return;
    onFullTime({ ...finishedState, goldDiffTimeline: [...view.goldDiffTimeline] }, { source: "live" });
  }, [finishedState, onFullTime, view.goldDiffTimeline]);

  // ── Controls ──────────────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    setSkipFailed(false);
    // The rest of this same match is played on the engine. When it cannot be, the match goes on.
    const finished = await session.skip();
    if (finished === null) setSkipFailed(true);
  }, [session]);
  const handleReset = useCallback(() => {
    setSkipFailed(false);
    setSelectedId(null);
    session.reset();
  }, [session]);

  // ── What the panels read ──────────────────────────────────────────────
  const pits = useMemo<SpotlightPit[]>(
    () =>
      pitViews(state).map((pit) => ({
        id: pit.id,
        pos: pit.pos,
        alive: pit.status.state === "alive",
        entity: pit.entity,
        dragonKind: pit.dragonKind,
        hpPct: pit.status.state === "alive" ? pit.status.hpPct : null,
      })),
    [state],
  );
  const spotlight = useMemo(
    () => buildSpotlight({ nowSec: state.timeSec, champions: state.champions, structures: state.structures, pits, winner: state.winner }, selectedId),
    [pits, selectedId, state],
  );
  const board = useMemo(
    () => buildFightBoard({ nowSec: state.timeSec, champions: state.champions, structures: state.structures }),
    [state.champions, state.structures, state.timeSec],
  );
  const roster = useMemo(
    () => state.champions.map((champion) => ({ id: champion.id, name: champion.name, team: champion.team })),
    [state.champions],
  );
  const fighting = useMemo(() => new Set(contacts.fightingIds), [contacts.fightingIds]);
  const cardsOf = useCallback(
    (team: TeamSide) => state.champions.filter((champion) => champion.team === team).sort((a, b) => roleRank(a.role) - roleRank(b.role)),
    [state.champions],
  );
  const cards = useMemo(() => ({ blue: cardsOf("blue"), red: cardsOf("red") }), [cardsOf]);

  const status: ScoreStatus = winner ? "final" : view.running ? "live" : "paused";
  const ended = Boolean(summary);

  const renderCards = (team: TeamSide, identity: { name: string }) => (
    <section className="live-side" data-team={team} aria-label={t("onAir.match.team.players", { team: identity.name })}>
      {cards[team].map((champion) => {
        const key = profiles.championByPlayerId[champion.id];
        return (
          <LivePlayerCard
            key={champion.id}
            champion={champion as CardChampion}
            opponent={opposingChampion(champion as CardChampion, state.champions as CardChampion[])}
            championKey={key}
            championName={key ? championDisplayName(key) : undefined}
            nowSec={state.timeSec}
            fighting={fighting.has(champion.id)}
            selected={selectedId === champion.id}
            itemNames={itemNames}
            onSelect={toggleSelected}
          />
        );
      })}
    </section>
  );

  return (
    <div className="live-match relative min-h-0 flex-1 bg-background text-foreground" data-testid="live-match">
      <div className="live-scroll scrollbar-v2" inert={ended || view.skipping ? true : undefined}>
        <div className="live-shell">
          <div className="live-area-bar">
            <ScoreBar state={state} blue={blue} red={red} status={status} bus={bus} />
          </div>

          <div className="live-area-map">
            <ArenaMap
              bus={bus}
              describedBy={FIGHT_BOARD_ID}
              paused={!view.running && !winner}
              layers={{
                structures: <StructureLayer state={state} beams={beams} />,
                pits: <PitMarkers state={state} />,
                minions: <MinionCanvas />,
                contacts: <ContactLayer state={state} contacts={contacts} />,
                champions: (
                  <ChampionLayer
                    state={state}
                    championByPlayerId={profiles.championByPlayerId}
                    contacts={contacts}
                    selectedId={selectedId}
                    onSelect={toggleSelected}
                  />
                ),
                callouts: <TowerFireLayer state={state} beams={beams} />,
              }}
            />
          </div>

          <div className="live-area-dock">
            <EventTicker events={state.events} roster={roster} />
            <SpotlightCaption spotlight={spotlight} onRelease={() => setSelectedId(null)} />
          </div>

          <div className="live-area-ctl">
            <MatchControls
              running={view.running}
              speed={view.speed}
              disabled={Boolean(winner) || view.skipping}
              onTogglePlay={() => session.setRunning(!view.running)}
              onSpeedChange={session.setSpeed}
              onSkip={handleSkip}
              onReset={handleReset}
            />
            <FightBoard rows={board} />
            <MapLegend />
            {/* In the row, not floating: a fixed button would sit over the map or a card. */}
            <FloatingBugButton placement="rail" />
            {skipFailed ? (
              <p className="live-notice" role="status">
                {t("onAir.match.controls.skipFailed")}
              </p>
            ) : null}
          </div>

          <div className="live-area-blue scrollbar-v2">{renderCards("blue", blue)}</div>
          <div className="live-area-red scrollbar-v2">{renderCards("red", red)}</div>
        </div>
      </div>

      {view.skipping ? (
        <div className="live-scrim" role="status">
          <span className="live-clearing">{t("match.clearingBattlefield")}</span>
        </div>
      ) : null}
      {summary ? <EndPanel summary={summary} blue={blue} red={red} onContinue={handleContinue} /> : null}
    </div>
  );
}
