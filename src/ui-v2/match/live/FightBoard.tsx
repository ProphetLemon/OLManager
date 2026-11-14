import { useTranslation } from "react-i18next";

import type { FightBoardRow } from "@/lib/match/live/fightBoard";

import { BOARD_KIND_KEYS, boardRowShort, boardRowText } from "./boardText";
import "./liveMatch.css";

/** The id the map's `aria-describedby` points at (with `AWAY_BOARD_ID`). */
export const FIGHT_BOARD_ID = "arena-fight-board";
export const AWAY_BOARD_ID = "arena-away-board";

/** The two strips of the board: who is fighting, and who is away from the map. */
export type FightBoardVariant = "fights" | "away";

const KINDS: Readonly<Record<FightBoardVariant, readonly FightBoardRow["kind"][]>> = {
  fights: ["contact", "turret"],
  away: ["recall", "dead"],
};

const TEXT: Readonly<Record<FightBoardVariant, { title: string; label: string; quiet: string }>> = {
  fights: { title: "onAir.match.board.heading", label: "onAir.match.board.label", quiet: "onAir.match.board.quiet" },
  away: { title: "onAir.match.board.away", label: "onAir.match.board.awayLabel", quiet: "onAir.match.board.awayQuiet" },
};

/** Rows the strip draws before it counts the rest; every row stays on the page for assistive technology. */
export const VISIBLE_ROWS = 2;

export interface FightBoardProps {
  rows: readonly FightBoardRow[];
  variant?: FightBoardVariant;
  id?: string;
}

/**
 * One strip of the Fight board, always on show: a kind chip and a few words per row, with the
 * full sentence kept beside them (visually hidden) as the map's text twin. It is not a live
 * region, so a ticking row is never announced: the event feed is the one place that announces.
 * Rows past the visible ones are clipped, not removed, and a "+N" says how many. Each row is
 * keyed by the id the pure board gives it, so a row that lasts across commits keeps its element.
 */
export function FightBoard({ rows, variant = "fights", id = variant === "fights" ? FIGHT_BOARD_ID : AWAY_BOARD_ID }: FightBoardProps) {
  const { t } = useTranslation();
  const text = TEXT[variant];
  const mine = rows.filter((row): row is Exclude<FightBoardRow, { kind: "quiet" }> => KINDS[variant].includes(row.kind));
  const extra = Math.max(0, mine.length - VISIBLE_ROWS);

  return (
    <section
      id={id}
      className="arena-board"
      data-variant={variant}
      data-testid={variant === "fights" ? "fight-board" : "away-board"}
    >
      <h3 className="arena-board-title">{t(text.title)}</h3>
      <ul className="arena-board-list" aria-label={t(text.label)}>
        {mine.length === 0 ? (
          <li className="arena-board-row" data-kind="quiet">
            <span className="arena-board-quiet">{t(text.quiet)}</span>
          </li>
        ) : (
          mine.map((row, index) => (
            <li key={row.id} className="arena-board-row" data-kind={row.kind} data-row-id={row.id} data-extra={index >= VISIBLE_ROWS || undefined}>
              <span className="arena-board-kind">{t(BOARD_KIND_KEYS[row.kind])}</span>
              <span className="arena-board-short" aria-hidden="true">
                {boardRowShort(row, t)}
              </span>
              <span className="arena-board-text">{boardRowText(row, t)}</span>
            </li>
          ))
        )}
        {extra > 0 ? (
          <li className="arena-board-more" aria-hidden="true">
            +{extra}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
