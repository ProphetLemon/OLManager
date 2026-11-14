import { Swords } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatClock } from "@/lib/match/live/clock";
import type { TimelineEntry } from "@/lib/match/live/postGameTimeline";

import { eventSentence } from "../live/eventSentence";
import { championTile, entryIcon } from "./postGameIcons";
import "./postGame.css";

export interface PostGameTimelineProps {
  entries: TimelineEntry[];
  /** Key of the champion each player picked, by player id: a kill shows the killer's portrait. */
  championByPlayerId: Record<string, string>;
  /** Game second after which events may be missing (the match was skipped); 0 when nothing was recorded; null when it is whole. */
  partialFromSec: number | null;
}

/** Past this many events the list runs in two columns, as long as the window is wide enough. */
const TWO_COLUMNS_FROM = 12;

function Event({ entry, championByPlayerId }: { entry: TimelineEntry; championByPlayerId: Record<string, string> }) {
  const { t } = useTranslation();
  const sentence = eventSentence(entry.event, t);
  const text = entry.kind === "firstBlood" ? `${t("match.draftResult.timelineEvents.firstBlood")}: ${sentence}` : sentence;
  const portrait = entry.kind === "kill" || entry.kind === "firstBlood" ? (entry.actorId ? championByPlayerId[entry.actorId] : undefined) : undefined;
  const icon = entryIcon(entry);
  return (
    <li className="pg-event" data-big={entry.big || undefined} data-kind={entry.kind}>
      <time>{formatClock(entry.t)}</time>
      <span className="pg-event-icon" data-team={entry.side ?? undefined} data-portrait={portrait ? "true" : undefined} aria-hidden="true">
        {portrait ? (
          <img src={championTile(portrait)} alt="" draggable={false} />
        ) : icon ? (
          <img src={icon} alt="" draggable={false} />
        ) : (
          <Swords width={16} height={16} focusable="false" />
        )}
      </span>
      <span>{text}</span>
    </li>
  );
}

/**
 * The key events of the match in time order: kills, structures, dragons, the Herald, the grubs, Baron
 * and the nexus, each with its time, its icon and the sentence the live feed uses. First blood is
 * named only when the match was watched whole. A skipped match says from when events may be missing.
 */
export function PostGameTimeline({ entries, championByPlayerId, partialFromSec }: PostGameTimelineProps) {
  const { t } = useTranslation();
  const split = entries.length > TWO_COLUMNS_FROM ? Math.ceil(entries.length / 2) : entries.length;
  const columns = entries.length === 0 ? [] : split < entries.length ? [entries.slice(0, split), entries.slice(split)] : [entries];
  return (
    <div data-testid="post-game-timeline">
      {partialFromSec !== null ? (
        <p className="pg-note" data-testid="timeline-partial">
          {partialFromSec > 0 ? t("onAir.match.post.timelinePartial", { time: formatClock(partialFromSec) }) : t("onAir.match.post.timelineNoRecord")}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p className="pg-note">{t("onAir.match.post.timelineEmpty")}</p>
      ) : (
        <div className="pg-timeline" data-single={columns.length === 1 || undefined}>
          {columns.map((column) => (
            <ol
              key={column[0].id}
              className="pg-events"
              aria-label={t("onAir.match.post.timelineColumn", { from: formatClock(column[0].t), to: formatClock(column[column.length - 1].t) })}
            >
              {column.map((entry) => (
                <Event key={entry.id} entry={entry} championByPlayerId={championByPlayerId} />
              ))}
            </ol>
          ))}
        </div>
      )}
    </div>
  );
}
