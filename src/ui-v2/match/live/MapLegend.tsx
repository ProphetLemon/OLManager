import { ChevronsRight, ChevronsUp, Map as MapIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { MARKER_LEGEND_KEYS } from "./ChampionMarker";
import { CONTACT_LEGEND_KEYS } from "./ContactLayer";
import "./liveMatch.css";

/** The rows the layers do not state themselves: shapes of the teams, camps, wards, the push badge, the cards. */
export const LEGEND_KEYS = {
  champions: "onAir.match.legend.champions",
  structures: "onAir.match.legend.structures",
  camp: "onAir.match.legend.camp",
  ward: "onAir.match.legend.ward",
  push: "onAir.match.legend.push",
  lanes: "onAir.match.legend.lanes",
  timers: "onAir.match.legend.timers",
  items: "onAir.match.legend.items",
  cooldowns: "onAir.match.legend.cooldowns",
} as const;

interface LegendRow {
  id: string;
  key: string;
  glyph: ReactNode;
}

const ShapePair = ({ kind }: { kind: "champion" | "structure" | "ward" }) => (
  <>
    <i className="arena-lg-shape" data-shape={kind} data-team="blue" />
    <i className="arena-lg-shape" data-shape={kind} data-team="red" />
  </>
);

const Line = ({ dashed, warm }: { dashed?: boolean; warm?: boolean }) => (
  <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true" focusable="false">
    <path className="arena-lg-line" data-tone={warm ? "warm" : "plain"} data-dashed={dashed || undefined} d="M1 6h24" />
    {warm ? <circle className="arena-lg-dot" cx="21" cy="6" r="4" /> : null}
  </svg>
);

/** In the order a person meets them: the people, the fight, the clocks, the places, then the cards. */
const ROWS: readonly LegendRow[] = [
  { id: "champions", key: LEGEND_KEYS.champions, glyph: <ShapePair kind="champion" /> },
  { id: "fighting", key: CONTACT_LEGEND_KEYS.ringFighting, glyph: <i className="arena-lg-ring" data-ring="fighting" /> },
  { id: "dot", key: CONTACT_LEGEND_KEYS.dot, glyph: <Line warm /> },
  { id: "shots", key: CONTACT_LEGEND_KEYS.shots, glyph: <span className="arena-lg-chip">x2</span> },
  { id: "beam", key: CONTACT_LEGEND_KEYS.beam, glyph: <Line dashed /> },
  { id: "fire", key: CONTACT_LEGEND_KEYS.ringFire, glyph: <i className="arena-lg-ring" data-ring="fire" /> },
  { id: "recall", key: MARKER_LEGEND_KEYS.recallRing, glyph: <i className="arena-lg-ring" data-ring="recall" /> },
  { id: "dead", key: MARKER_LEGEND_KEYS.deadOutline, glyph: <i className="arena-lg-ring" data-ring="dead" /> },
  { id: "structures", key: LEGEND_KEYS.structures, glyph: <ShapePair kind="structure" /> },
  { id: "camp", key: LEGEND_KEYS.camp, glyph: <i className="arena-lg-camp" /> },
  { id: "ward", key: LEGEND_KEYS.ward, glyph: <ShapePair kind="ward" /> },
  { id: "push", key: LEGEND_KEYS.push, glyph: <ChevronsUp aria-hidden="true" focusable="false" className="arena-lg-icon" /> },
  { id: "lanes", key: LEGEND_KEYS.lanes, glyph: <ChevronsRight aria-hidden="true" focusable="false" className="arena-lg-icon" /> },
  { id: "timers", key: LEGEND_KEYS.timers, glyph: null },
  { id: "items", key: LEGEND_KEYS.items, glyph: null },
  { id: "cooldowns", key: LEGEND_KEYS.cooldowns, glyph: null },
];

/**
 * The key to the map. Every row is a small picture and a sentence; the picture is decoration
 * and the sentence is the legend. It is a native details, closed by default so the map and the
 * controls keep the room, and its rows stay in the DOM.
 */
export function MapLegend() {
  const { t } = useTranslation();
  return (
    <details className="arena-legend" data-testid="map-legend">
      <summary className="arena-legend-summary" title={t("onAir.match.legend.heading")}>
        <MapIcon className="arena-btn-icon" aria-hidden="true" focusable="false" />
        {/* Clipped, not removed, where the row is narrow: the summary keeps its name and becomes an icon. */}
        <span className="arena-btn-label">{t("onAir.match.legend.heading")}</span>
      </summary>
      <ul className="arena-legend-list">
        {ROWS.map((row) => (
          <li key={row.id} className="arena-lg-row" data-row={row.id}>
            {row.glyph ? (
              <span className="arena-lg-glyph" aria-hidden="true">
                {row.glyph}
              </span>
            ) : null}
            <span className="arena-lg-text">{t(row.key)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
