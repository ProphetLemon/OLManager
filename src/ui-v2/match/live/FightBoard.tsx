import { useTranslation } from "react-i18next";

import type { FightBoardRow } from "@/lib/match/live/fightBoard";

import { BOARD_KIND_KEYS, boardRowText } from "./boardText";
import "./liveMatch.css";

/** The id the map's `aria-describedby` points at. */
export const FIGHT_BOARD_ID = "arena-fight-board";

export interface FightBoardProps {
  rows: readonly FightBoardRow[];
  id?: string;
}

/**
 * The map's text twin, as a native `<details>` closed by default. The rows stay in the DOM while
 * it is closed, so the map's `aria-describedby` always resolves; the summary opens and closes
 * with Enter and Space and needs no script. Each row is keyed by the id the pure board gives it,
 * so a row that lasts across commits keeps its element.
 */
export function FightBoard({ rows, id = FIGHT_BOARD_ID }: FightBoardProps) {
  const { t } = useTranslation();
  const active = rows.filter((row) => row.kind !== "quiet").length;

  return (
    <details id={id} className="arena-board" data-testid="fight-board">
      <summary className="arena-board-summary">
        <span className="arena-board-title">{t("onAir.match.board.heading")}</span>
        <span className="arena-board-count">
          {active === 0 ? t("onAir.match.board.summaryQuiet") : t("onAir.match.board.summary", { count: active })}
        </span>
      </summary>
      <ul className="arena-board-list" aria-label={t("onAir.match.board.label")}>
        {rows.map((row) => (
          <li key={row.id} className="arena-board-row" data-kind={row.kind} data-row-id={row.id}>
            <span className="arena-board-kind">{t(BOARD_KIND_KEYS[row.kind])}</span>
            <span className="arena-board-text">{boardRowText(row, t)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
