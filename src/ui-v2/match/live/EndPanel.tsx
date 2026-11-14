import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { formatClock } from "@/lib/match/live/clock";
import type { EndSummary } from "@/lib/match/live/endSummary";
import { compactGold } from "@/lib/match/live/formatNumbers";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";
import { Button } from "@/ui-v2/components/ui/button";

import { SideCrest } from "./SideCrest";
import "./liveMatch.css";

export interface EndPanelProps {
  summary: EndSummary;
  blue: TeamIdentity;
  red: TeamIdentity;
  /** Hands the finished match on. Nothing leaves this screen before it is pressed. */
  onContinue: () => void;
}

/**
 * The result of the match, over the map. It waits: the screen moves on only when Continue is
 * pressed, so a person can look at the final numbers for as long as they want. Focus lands on
 * Continue because the rest of the screen is inert behind it. It aligns to the top and scrolls on
 * its own, so on a phone nothing of it is out of reach.
 */
export function EndPanel({ summary, blue, red, onContinue }: EndPanelProps) {
  const { t, i18n } = useTranslation();
  const continueRef = useRef<HTMLButtonElement>(null);
  const winner = summary.winner === "blue" ? blue : red;
  const gold = (amount: number) => compactGold(amount, i18n.language);
  const leader = summary.lead.side === "blue" ? blue : summary.lead.side === "red" ? red : null;

  useEffect(() => {
    continueRef.current?.focus();
  }, []);

  const rows = [
    { id: "towers", label: t("match.statTowers"), blue: summary.blue.towers, red: summary.red.towers },
    { id: "dragons", label: t("match.statDragons"), blue: summary.blue.dragons, red: summary.red.dragons },
    { id: "gold", label: t("match.statGold"), blue: gold(summary.blue.gold), red: gold(summary.red.gold) },
  ];

  return (
    <div className="live-scrim" data-testid="end-scrim">
      <section
        className="live-end"
        role="dialog"
        aria-modal="true"
        aria-label={t("onAir.match.end.label")}
        data-testid="end-panel"
        data-outcome={summary.outcome ?? "neutral"}
      >
        <span className="live-end-kicker">{t("match.matchOver")}</span>
        <div className="live-end-winner">
          <SideCrest side={summary.winner} identity={winner} size="3rem" />
          <h2 className="live-end-result">
            {summary.outcome === "victory"
              ? t("match.victory")
              : summary.outcome === "defeat"
                ? t("match.defeat")
                : t("onAir.match.end.winner", { team: winner.name })}
          </h2>
        </div>
        <p className="live-end-score">
          <span data-team="blue">{summary.blue.kills}</span>
          <span aria-hidden="true">-</span>
          <span data-team="red">{summary.red.kills}</span>
          <span className="live-end-duration">
            {t("match.draftResult.duration")} {formatClock(summary.durationSec)}
          </span>
        </p>
        <table className="live-end-stats">
          <thead>
            <tr>
              <td />
              <th scope="col" data-team="blue">
                <span className="live-end-colhead">
                  <SideCrest side="blue" identity={blue} size="1.5rem" />
                  {blue.tag}
                </span>
              </th>
              <th scope="col" data-team="red">
                <span className="live-end-colhead">
                  <SideCrest side="red" identity={red} size="1.5rem" />
                  {red.tag}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-row={row.id}>
                <th scope="row">{row.label}</th>
                <td>{row.blue}</td>
                <td>{row.red}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="live-end-lead">
          {leader
            ? t("onAir.match.end.lead", { team: leader.name, amount: gold(summary.lead.amount) })
            : t("onAir.match.end.leadEven")}
        </p>
        <Button ref={continueRef} type="button" variant="club" size="touch" className="live-end-continue" onClick={onContinue}>
          {t("match.continue")}
        </Button>
      </section>
    </div>
  );
}
