import type { ReactNode } from "react";

import type { PlayerData } from "@/store/gameStore";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";
import { roleLabel } from "./TransferPlayerPicker";

export type DecisionTone = "accepted" | "rejected" | "other";

const DECISION_CLASS: Record<DecisionTone, string> = {
  accepted: "text-emerald-500",
  rejected: "text-destructive",
  other: "text-amber-500",
};

export function decisionTone(decision: string): DecisionTone {
  return decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "other";
}

/** Role badge + player name + a one-line context caption. */
export function DialogPlayerHeader({ player, caption }: { player: PlayerData; caption: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Badge variant="secondary">{roleLabel(player)}</Badge>
      <div>
        <p className="text-sm font-semibold text-foreground">{player.match_name || player.full_name}</p>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}

export function DecisionLine({ tone, children }: { tone: DecisionTone; children: ReactNode }) {
  return (
    <div className={cn("font-heading text-xs font-bold uppercase tracking-wider", DECISION_CLASS[tone])}>
      {children}
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-xs text-destructive">
      {children}
    </p>
  );
}
