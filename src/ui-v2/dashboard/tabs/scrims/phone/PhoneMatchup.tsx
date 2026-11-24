import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { TeamIdentity } from "@/lib/teams/teamIdentity";
import { cn } from "@/ui-v2/lib/utils";
import { TeamShield } from "./TeamShield";

function Side({ identity, lines }: { identity: TeamIdentity; lines: 1 | 2 }) {
  return (
    <div data-slot="phone-matchup-team" className="flex w-[5.5rem] shrink-0 flex-col items-center gap-1">
      <TeamShield identity={identity} size="medium" />
      <span className={cn("max-w-full text-center font-heading text-entry font-semibold leading-tight", lines === 1 ? "truncate" : "line-clamp-2")}>
        {identity.name}
      </span>
    </div>
  );
}

/** A medium matchup (K1): your club and the rival, each with its logo and its name; `middle` sits between them. */
export function PhoneMatchup({ you, rival, middle, lines = 1, className }: { you: TeamIdentity; rival: TeamIdentity; middle?: ReactNode; lines?: 1 | 2; className?: string }) {
  return (
    <div data-slot="phone-matchup" className={cn("flex items-start justify-between gap-2", className)}>
      <Side identity={you} lines={lines} />
      {middle}
      <Side identity={rival} lines={lines} />
    </div>
  );
}

/** The result as a word: red only for a loss (K2), and the word is always there. */
export function ResultWord({ won, className }: { won: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      data-slot="phone-result-word"
      data-result={won ? "won" : "lost"}
      className={cn("font-heading font-bold uppercase leading-none", won ? "text-positive" : "text-negative", className)}
    >
      {won ? t("scrims.reviewWin") : t("scrims.reviewLoss")}
    </span>
  );
}
