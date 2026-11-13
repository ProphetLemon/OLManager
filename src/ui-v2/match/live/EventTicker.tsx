import { Castle, Gem, Shell, Swords, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { initialsOf } from "@/lib/match/live/championMarker";
import { formatClock } from "@/lib/match/live/clock";
import { parseFeed, type FeedEntry, type FeedSourceEvent, type RosterEntry } from "@/lib/match/live/liveEvents";
import { NEUTRAL_OBJECTIVE_ICON_PATH } from "@/lib/match/lolMapLayout";

import { causeText, entrySentence } from "./feedText";
import "./liveMatch.css";

/** The feed shows this many entries, however many the engine has logged (it keeps 200). */
export const FEED_LIMIT = 8;

type Glyph = { src: string } | { Icon: LucideIcon } | null;

function glyphOf(entry: FeedEntry): Glyph {
  switch (entry.kind) {
    case "tower":
      return { Icon: Castle };
    case "nexus":
      return { Icon: Gem };
    case "dragon":
      return { src: entry.dragonKind ? NEUTRAL_OBJECTIVE_ICON_PATH[`dragon_${entry.dragonKind}`] : NEUTRAL_OBJECTIVE_ICON_PATH.dragon };
    case "elder":
      return { src: NEUTRAL_OBJECTIVE_ICON_PATH.dragon_elder };
    case "baron":
      return { src: NEUTRAL_OBJECTIVE_ICON_PATH.baron };
    case "objective":
      if (entry.objective === "herald") return { src: NEUTRAL_OBJECTIVE_ICON_PATH.riftherald };
      if (entry.objective === "scuttle") return { Icon: Shell };
      return { src: NEUTRAL_OBJECTIVE_ICON_PATH.grub };
    default:
      return null;
  }
}

export interface EventTickerProps {
  /** The engine's event log of the last answer. */
  events: readonly FeedSourceEvent[] | null | undefined;
  roster: readonly RosterEntry[];
  limit?: number;
}

/**
 * The kill and objective feed, newest first, as a list a keyboard user can focus and scroll.
 * A second, visually hidden, polite live region announces the newest event and nothing else, so
 * a screen reader hears each event once and the list itself is never re-read. The newest entry
 * fades in with opacity only, and not at all for people who ask for less motion.
 */
export function EventTicker({ events, roster, limit = FEED_LIMIT }: EventTickerProps) {
  const { t } = useTranslation();
  const entries = useMemo(() => parseFeed(events, roster, limit), [events, roster, limit]);
  const newest = entries[0];
  const latest = newest ? t("onAir.match.feed.latest", { time: formatClock(newest.t), text: entrySentence(newest, t) }) : "";

  return (
    <section className="arena-ticker" aria-label={t("onAir.match.feed.section")} data-testid="event-ticker">
      <span className="arena-ticker-heading" aria-hidden="true">
        {t("onAir.match.feed.heading")}
      </span>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {latest}
      </p>
      {entries.length === 0 ? (
        <p className="arena-tk-empty">{t("match.waitingFirstSkirmish")}</p>
      ) : (
        <ul className="arena-tk-list" role="list" tabIndex={0} aria-label={t("onAir.match.feed.label")}>
          {entries.map((entry, index) => {
            const sentence = entrySentence(entry, t);
            const glyph = glyphOf(entry);
            return (
              <li key={entry.id} className="arena-tk" data-kind={entry.kind} data-new={index === 0 || undefined}>
                <span className="arena-tk-time">{formatClock(entry.t)}</span>
                {entry.kind === "kill" ? (
                  <>
                    <span className="arena-tk-kill" aria-hidden="true">
                      <span className="arena-tk-ini" data-team={entry.killer.team ?? undefined}>
                        {initialsOf(entry.killer.name)}
                      </span>
                      <span className="arena-tk-name">{entry.killer.name}</span>
                      <Swords className="arena-tk-swords" focusable="false" />
                      <span className="arena-tk-ini" data-team={entry.victim.team ?? undefined}>
                        {initialsOf(entry.victim.name)}
                      </span>
                      <span className="arena-tk-name">{entry.victim.name}</span>
                      {entry.cause ? <span className="arena-tk-cause">({causeText(entry.cause, t)})</span> : null}
                    </span>
                    <span className="sr-only">{sentence}</span>
                  </>
                ) : (
                  <>
                    {glyph ? (
                      <span className="arena-tk-icon" data-team={entry.side ?? undefined} aria-hidden="true">
                        {"src" in glyph ? (
                          <img src={glyph.src} alt="" draggable={false} />
                        ) : (
                          <glyph.Icon focusable="false" />
                        )}
                      </span>
                    ) : null}
                    <span className="arena-tk-text">{sentence}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
