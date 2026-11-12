import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import type { EffectLine } from "@/lib/scrims/decisionEffects";
import type { ResultRow } from "@/lib/scrims/decisionResult";

/** A signed whole number with an ASCII minus, the way the impact tags write their signs. */
export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Morale and condition of the picked players as one phrase, leaving out what does not change. */
export function usePlayerChanges() {
  const { t } = useTranslation();
  return (morale: number, condition: number): string =>
    [
      morale !== 0 ? t("scrims.effect.morale", { delta: signed(morale) }) : null,
      condition !== 0 ? t("scrims.effect.condition", { delta: signed(condition) }) : null,
    ]
      .filter(Boolean)
      .join(", ");
}

/** A line is a cost when the game charges the club for it. */
export function isCostLine(line: EffectLine): boolean {
  return line.kind === "cancelsNext" || line.kind === "cancelStep" || line.kind === "severeLoss";
}

/** One line of a decision card: what the decision does, in words. */
export function EffectLineText({ line }: { line: EffectLine }) {
  const { t } = useTranslation();
  const playerChanges = usePlayerChanges();
  const cost = isCostLine(line);

  let text: string;
  switch (line.kind) {
    case "quality":
      text = t("scrims.effect.quality", { delta: signed(line.delta) });
      break;
    case "severity":
      text = t("scrims.effect.severity", { delta: signed(line.delta) });
      break;
    case "players":
      text = t("scrims.effect.players", { changes: playerChanges(line.morale, line.condition) });
      break;
    case "severeLoss":
      text = t("scrims.effect.severeLoss");
      break;
    case "cancelsNext":
      text = t("scrims.effect.cancelsNext", { label: line.label, rep: signed(line.reputation), count: line.cancellations });
      break;
    case "cancelStep":
      text = t("scrims.effect.cancelStep", { label: line.label, rep: signed(line.reputation), count: line.cancellations });
      break;
    case "playsNext":
      text = t("scrims.effect.playsNext", { label: line.label });
      break;
    case "closesDay":
      text = t("scrims.effect.closesDay");
      break;
  }

  return (
    <li className={cost ? "flex items-start gap-2 font-medium text-warning" : "flex items-start gap-2"}>
      {cost ? (
        <>
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="sr-only">{t("scrims.tagCost")}: </span>
        </>
      ) : null}
      <span>{text}</span>
    </li>
  );
}

/** The label of a changed number in the confirmation. */
export const RESULT_FIELD_KEY = {
  quality: "scrims.reportQuality",
  severity: "scrims.effect.severityLabel",
  reputation: "scrims.reputation",
  cancellations: "scrims.cancellations",
} as const;

export function resultRowIsCost(row: ResultRow): boolean {
  return (row.kind === "change" && row.cost) || (row.kind === "block" && row.state === "cancelled");
}
