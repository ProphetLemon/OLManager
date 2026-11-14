import { Table2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { compactGold } from "@/lib/match/live/formatNumbers";
import type { BarChart } from "@/lib/match/live/postGame";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";

import { Portrait } from "./Portrait";
import "./postGame.css";

export interface BarChartPanelProps {
  /** Used to name the heading and to tie the summary to the chart. */
  id: string;
  title: string;
  chart: BarChart;
  blue: TeamIdentity;
  red: TeamIdentity;
  championByPlayerId: Record<string, string>;
  /** Extra table columns: a heading and the value of each player, or null when it was not recorded. */
  extraColumns?: Array<{ id: string; heading: string; value: (playerId: string) => number | null }>;
}

/**
 * One stat for all ten players: a bar each, grouped by team and sorted, with the value at the end
 * of the bar, the share of the team and the portrait at the start. A table with the same numbers
 * (and any extra columns) replaces the bars on request, and a text summary names the totals and
 * the highest player, so the values never depend on seeing the bars.
 */
export function BarChartPanel({ id, title, chart, blue, red, championByPlayerId, extraColumns = [] }: BarChartPanelProps) {
  const { t, i18n } = useTranslation();
  const [table, setTable] = useState(false);
  const value = (amount: number) => compactGold(amount, i18n.language);
  const percent = (share: number) => new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 0 }).format(share);
  const identity = { blue, red } as const;
  const [blueGroup, redGroup] = chart.groups;
  const summary = t("onAir.match.post.barSummary", {
    title,
    blue: blue.name,
    blueTotal: value(blueGroup.total),
    red: red.name,
    redTotal: value(redGroup.total),
    name: chart.top.name,
    value: value(chart.top.value),
  });
  const flat = chart.groups.flatMap((group) => group.rows);
  // A column nobody recorded is left out, not shown as a column of dashes.
  const columns = extraColumns.filter((column) => flat.some((row) => column.value(row.id) !== null));

  return (
    <section className="pg-panel" aria-labelledby={`pg-${id}-title`} aria-describedby={`pg-${id}-summary`} data-testid={`${id}-chart`}>
      <div className="pg-panel-head">
        <h3 id={`pg-${id}-title`}>{title}</h3>
        <span className="pg-legend" aria-hidden="true">
          <span>
            <i className="pg-shape" data-team="blue" />
            {blue.tag}
          </span>
          <span>
            <i className="pg-shape" data-team="red" />
            {red.tag}
          </span>
        </span>
        <button type="button" className="pg-toggle" aria-pressed={table} onClick={() => setTable((on) => !on)}>
          <Table2 aria-hidden="true" focusable="false" />
          {t("onAir.match.post.table")}
        </button>
      </div>
      <p className="sr-only" id={`pg-${id}-summary`}>
        {summary}
      </p>
      {table ? (
        <div className="pg-values">
          <table aria-label={t("onAir.match.post.valuesLabel", { title })}>
            <thead>
              <tr>
                <th scope="col">{t("common.player")}</th>
                <th scope="col">{t("common.team")}</th>
                <th scope="col">{t("common.value")}</th>
                <th scope="col">{t("onAir.match.post.teamShare")}</th>
                {columns.map((column) => (
                  <th key={column.id} scope="col">
                    {column.heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flat.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  <td>{identity[row.side].tag}</td>
                  <td>{value(row.value)}</td>
                  <td>{percent(row.share)}</td>
                  {columns.map((column) => {
                    const amount = column.value(row.id);
                    return <td key={column.id}>{amount === null ? "-" : value(amount)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {chart.groups.map((group) => (
            <div key={group.side} className="pg-group" role="group" aria-label={`${identity[group.side].name}, ${value(group.total)}`}>
              <div className="pg-group-head" data-team={group.side}>
                <i className="pg-shape" data-team={group.side} aria-hidden="true" />
                {identity[group.side].tag}
                <b>{value(group.total)}</b>
              </div>
              {group.rows.map((row) => (
                <div
                  key={row.id}
                  className="pg-barrow"
                  data-team={row.side}
                  role="img"
                  aria-label={t("onAir.match.post.barRow", { name: row.name, value: value(row.value), share: percent(row.share) })}
                >
                  <Portrait side={row.side} championKey={championByPlayerId[row.id]} name={row.name} size="sm" />
                  <span className="pg-barrow-name">{row.name}</span>
                  <span className="pg-barrow-bar">
                    <i style={{ width: `calc(${(row.width * 100).toFixed(2)}% * 0.8)` }} />
                    <b>{value(row.value)}</b>
                    <small>{percent(row.share)}</small>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
