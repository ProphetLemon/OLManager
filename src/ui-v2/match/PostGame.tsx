import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { championDisplayName } from "@/lib/champions/championNames";
import { formatClock } from "@/lib/match/live/clock";
import { championKeysOf, hasPlayedOutState, postGameStateFromResult, timelineFromResult } from "@/lib/match/live/draftResultState";
import { buildScoreboard, keyEventsOf, type PostGameState, type Side } from "@/lib/match/live/postGame";
import { buildTimeline } from "@/lib/match/live/postGameTimeline";
import type { SeriesStatus } from "@/lib/match/live/seriesStatus";
import { buildLolScrimPrepInsight } from "@/lib/scrims/lolScrimPrep";
import type { GameStateData } from "@/store/gameStore";
import { useItemNames } from "@/ui-v2/_legacy/components/match/itemNames";
import type { DraftMatchResult } from "@/ui-v2/_legacy/components/match/draftResultSimulator";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import { Button } from "@/ui-v2/components/ui/button";

import { SideCrest } from "./live/SideCrest";
import type { ChampionSelectionByPlayer } from "./live/useChampionProfiles";
import { Portrait } from "./post/Portrait";
import { PostGameGraphs } from "./post/PostGameGraphs";
import { PostGameScoreboard } from "./post/PostGameScoreboard";
import { PostGameTimeline } from "./post/PostGameTimeline";
import { useSideIdentities } from "./post/useSideIdentities";
import "./post/postGame.css";

type View = "scoreboard" | "graphs" | "timeline";
const VIEWS: ReadonlyArray<{ id: View; key: string }> = [
  { id: "scoreboard", key: "onAir.match.bar.label" },
  { id: "graphs", key: "onAir.match.post.viewGraphs" },
  { id: "timeline", key: "onAir.match.post.viewTimeline" },
];

export interface PostGameProps {
  snapshot: MatchSnapshot;
  gameState: GameStateData | null;
  /** The manager's side, if they were in this match. */
  userSide: "Home" | "Away" | null;
  /** The finished state the live screen handed on, with its record. Null when the match was never watched. */
  finalRuntimeState: LolSimV1RuntimeState | null;
  /** What the draft picked, by player id: the portraits. */
  championSelections?: ChampionSelectionByPlayer | null;
  /** The result of a match that was simulated, not played out: it stands in for a state with no champions. */
  result?: DraftMatchResult | null;
  /** Where a best-of series stands, when this game is one of several. */
  series?: { length: 1 | 3 | 5; status: SeriesStatus };
  /** Continue: the next game of an unfinished series, or the end of the match. */
  onFinish: () => void;
  /** Without it the press conference button is not shown. */
  onPressConference?: () => void;
}

/**
 * The screen after the match, in the two clubs' colours: the result bar, then a view switch between
 * the scoreboard, the graphs and the timeline, and the buttons that move the flow on. It shows only
 * what the engine sent and what the live screen recorded; where the match was skipped or a stat is
 * missing it says so or leaves the stat out, and never fills the hole.
 */
export default function PostGame({ snapshot, gameState, userSide, finalRuntimeState, championSelections, result, series, onFinish, onPressConference }: PostGameProps) {
  const { t } = useTranslation();
  const { blue, red, style } = useSideIdentities(snapshot, gameState);
  const itemNames = useItemNames();
  const [view, setView] = useState<View>("scoreboard");

  // The engine's JSON carries more than the contract types declare (event codes and data, damage).
  // A simulated match hands on an empty state; its result is then what the screen reads.
  const fromResult = Boolean(result) && !hasPlayedOutState(finalRuntimeState);
  const state = useMemo<PostGameState | null>(
    () => (fromResult && result ? postGameStateFromResult(result) : (finalRuntimeState as unknown as PostGameState | null)),
    [fromResult, result, finalRuntimeState],
  );
  const board = useMemo(() => (state ? buildScoreboard(state) : null), [state]);
  const championByPlayerId = useMemo<Record<string, string>>(
    () => ({ ...(fromResult && result ? championKeysOf(result) : {}), ...(championSelections?.home ?? {}), ...(championSelections?.away ?? {}) }),
    [championSelections, fromResult, result],
  );
  const record = state?.matchRecord;
  const entries = useMemo(
    () =>
      fromResult && result
        ? timelineFromResult(result)
        : state && board
        ? buildTimeline(keyEventsOf(state), {
            complete: record?.skippedAtSec === null,
            roster: [...board.rows.blue, ...board.rows.red].map((row) => ({ id: row.id, name: row.name, team: row.side })),
          })
        : [],
    [state, board, record, fromResult, result],
  );
  // Whole for a match watched to its end; from the skip for a skipped one; unknown with no record at all.
  // A simulation knows every event it made.
  const partialFromSec = fromResult ? null : record ? record.skippedAtSec : 0;

  const userBlue: Side | null = userSide === "Home" ? "blue" : userSide === "Away" ? "red" : null;
  const identity = { blue, red } as const;
  const scrim = buildLolScrimPrepInsight(snapshot.lol_scrim_prep, userSide === "Away" ? "away" : "home");
  const scrimFocus = scrim ? t(scrim.focusLabel.key, { defaultValue: scrim.focusLabel.defaultValue }) : null;

  const mvp = board?.mvp ?? null;
  const mvpChampion = mvp && championByPlayerId[mvp.id] ? championDisplayName(championByPlayerId[mvp.id]) : null;
  const viewLabel = t(VIEWS.find((candidate) => candidate.id === view)?.key ?? VIEWS[0].key);

  const sideBar = (side: Side) => {
    const club = identity[side];
    const won = board?.winner === side;
    return (
      <div className="pg-side" data-team={side} data-yours={userBlue === side || undefined}>
        <SideCrest side={side} identity={club} size="3.25rem" />
        <span className="pg-side-name">
          <b>{club.tag}</b>
          <span>{club.name}</span>
        </span>
        {board?.winner ? (
          <span className="pg-result" data-result={won ? "win" : "loss"}>
            {won ? t("match.victory") : t("match.defeat")}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="post-game" style={style} data-testid="post-game" data-your-side={userBlue ?? undefined}>
      <header className="pg-top" aria-label={t("onAir.match.end.label")}>
        {sideBar("blue")}
        <div className="pg-mid">
          <span className="pg-kills" data-team="blue" role="img" aria-label={board ? t("onAir.match.bar.kills", { team: blue.name, value: board.totals.blue.kills }) : undefined}>
            {board ? board.totals.blue.kills : "-"}
          </span>
          <span className="pg-clock">
            <b>
              <span className="sr-only">{t("match.draftResult.duration")} </span>
              {board ? formatClock(board.durationSec) : "-"}
            </b>
            <span className="pg-badge">{t("match.matchOver")}</span>
          </span>
          <span className="pg-kills" data-team="red" role="img" aria-label={board ? t("onAir.match.bar.kills", { team: red.name, value: board.totals.red.kills }) : undefined}>
            {board ? board.totals.red.kills : "-"}
          </span>
        </div>
        {sideBar("red")}
      </header>

      <div className="pg-tabs">
        {board ? (
          <fieldset className="pg-views">
            <legend className="sr-only">{t("onAir.match.post.viewLabel")}</legend>
            {VIEWS.map((candidate) => (
              <label key={candidate.id}>
                <input type="radio" name="post-game-view" value={candidate.id} checked={view === candidate.id} onChange={() => setView(candidate.id)} />
                <span>{t(candidate.key)}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <span />
        )}
        {series && series.length > 1 ? (
          <div className="pg-series" role="group" aria-label={t("match.draftResult.series")} data-testid="post-game-series">
            <span className="pg-series-score">
              {t("match.draftResult.series")} ({series.length === 3 ? "Bo3" : "Bo5"}) · {series.status.userWins} - {series.status.opponentWins}
            </span>
            {series.status.games.map((game) => (
              <span key={game.gameIndex} className="pg-series-game" data-team={game.winnerSide}>
                {t("match.seriesGame", { game: game.gameIndex })}
                {game.winnerSide ? (
                  <>
                    <i className="pg-shape" aria-hidden="true" />
                    {identity[game.winnerSide].tag}
                  </>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        {mvp ? (
          <div className="pg-mvpchip" role="group" aria-label={`${t("match.draftResult.mvp")}: ${mvp.name}`}>
            <Portrait side={mvp.side} championKey={championByPlayerId[mvp.id]} name={mvp.name} />
            <span className="pg-mvpchip-text">
              <b>
                {t("match.draftResult.mvp")} {mvp.name}
              </b>
              <small>{`${mvpChampion ? `${mvpChampion}, ` : ""}${mvp.kills}/${mvp.deaths}/${mvp.assists}`}</small>
            </span>
          </div>
        ) : null}
      </div>

      <main className="pg-main" tabIndex={0} aria-label={board ? viewLabel : t("match.matchOver")}>
        {!board ? (
          <p className="pg-note" data-testid="post-game-empty">
            {t("onAir.match.post.noRecord")}
          </p>
        ) : view === "scoreboard" ? (
          <>
            {scrim ? (
              <p className="pg-scrim" data-testid="scrim-prep">
                <b>{t(scrim.title.key, { defaultValue: scrim.title.defaultValue })}</b> +{scrim.totalSignal}.{" "}
                {t(scrim.summary.key, { ...scrim.summary.values, focus: scrimFocus ?? scrim.focusLabel.defaultValue, defaultValue: scrim.summary.defaultValue })}
              </p>
            ) : null}
            <PostGameScoreboard
              board={board}
              blue={blue}
              red={red}
              championByPlayerId={championByPlayerId}
              itemNames={itemNames}
            />
          </>
        ) : view === "graphs" ? (
          <PostGameGraphs board={board} record={record} entries={entries} blue={blue} red={red} championByPlayerId={championByPlayerId} />
        ) : (
          <PostGameTimeline entries={entries} championByPlayerId={championByPlayerId} partialFromSec={partialFromSec} teams={{ blue: blue.tag, red: red.tag }} />
        )}
      </main>

      <footer className="pg-foot">
        {onPressConference ? (
          <Button type="button" variant="outline" size="touch" onClick={onPressConference}>
            {t("match.pressConference")}
          </Button>
        ) : null}
        <Button type="button" variant="club" size="touch" onClick={onFinish}>
          {series && series.length > 1 && !series.status.finished ? `${t("match.game")} ${series.status.nextGameLabel}` : t("match.continue")}
        </Button>
      </footer>
    </div>
  );
}
