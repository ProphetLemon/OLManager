import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, CircleHelp, X } from "lucide-react";

import type { RivalRow } from "@/lib/scrims/rivalOdds";
import { teamIdentity, type TeamIdentity } from "@/lib/teams/teamIdentity";
import type { TeamData } from "@/store/gameStore";
import { Button } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { Meter } from "@/ui-v2/components/ui/meter";
import { cn } from "@/ui-v2/lib/utils";
import { useBackDismisser } from "@/ui-v2/palette/useBackDismisser";
import { ScrimViewFrame } from "./ScrimViewFrame";
import { EmptyShield, TeamShield } from "./TeamShield";

export interface ScrimPickViewProps {
  /** "Wed A": the title of the view and the name of its back control. */
  slotLabel: string;
  myTeam: TeamData;
  /** Every team of the game: the source of each rival's tag and real logo. */
  teams: readonly TeamData[];
  /** Plan A, B and C as team ids, an empty string where nothing is set. */
  plan: readonly string[];
  /** The rivals of the competition in the game's order (`buildRivalRows`). */
  rivals: readonly RivalRow[];
  ownReputation: number;
  /** The slot cannot be edited (week locked, assistant on, slot past): the plans can be looked at, not changed. */
  readOnly: boolean;
  /** A save is running: everything keeps its place but a tap does nothing. */
  disabled: boolean;
  /** Why it is read-only; takes the place of the word Accepts on the strip. */
  blockedText: string | null;
  /** Where Done leads, already worded ("Wed B", "Volume"). */
  doneTo: string;
  /** Saves one plan at once; an empty `teamId` clears it. */
  onPick: (priorityIndex: number, teamId: string) => void;
  onDone: () => void;
  onBack: () => void;
  /** The rival this slot actually played; marks that plan's tab once the slot is read-only. */
  resolvedTeamId?: string | null;
  /** The plan was cleared today (wording of the read-only form). */
  cleared?: boolean;
}

const PLANS = [0, 1, 2] as const;
const LETTERS = ["A", "B", "C"] as const;
const PLAN_KEYS = ["training.scrims.planA", "training.scrims.planB", "training.scrims.planC"] as const;
const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** A chance as the card draws it: the number large, its word, and a bar with the mark at 50. */
function Odds({ label, value, tone, mirror }: { label: string; value: number; tone: "club" | "info"; mirror?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden="true" className={cn("flex items-baseline gap-2", mirror && "flex-row-reverse")}>
        <span className="font-heading text-title font-bold tabular-nums">
          {value}
          <span className="text-section">%</span>
        </span>
        <span className="text-entry font-medium text-muted-foreground">{label}</span>
      </div>
      <div dir={mirror ? "rtl" : undefined}>
        <Meter label={label} value={value} valueText={`${value}%`} tone={tone} showValue={false} tick={50} />
      </div>
    </div>
  );
}

/**
 * Elegir rival (frames Pick and Pick16): one slot, in the view frame. The top row holds the three
 * plans and Not planned; the card shows the matchup of the plan being filled; the strip lists every
 * rival of the competition. A tap saves the rival for the plan being filled and the plan does not
 * move on by itself. Mount it with a key per slot so it starts on Plan A.
 */
export function ScrimPickView(props: ScrimPickViewProps) {
  const { slotLabel, myTeam, teams, plan, rivals, ownReputation, readOnly, disabled, blockedText, doneTo, onPick, onDone, onBack, resolvedTeamId = null, cleared = false } = props;
  const { t } = useTranslation();
  // A read-only slot that was played opens on the plan that was played, so the card shows what happened.
  const [active, setActive] = useState(() => (readOnly && resolvedTeamId != null ? Math.max(0, plan.indexOf(resolvedTeamId)) : 0));
  const [helpOpen, setHelpOpen] = useState(false);
  useBackDismisser(helpOpen, () => setHelpOpen(false));

  const identityOf = useMemo(() => {
    const known = new Map(teams.map((team) => [team.id, teamIdentity(team)]));
    return (id: string): TeamIdentity => {
      const name = rivals.find((row) => row.teamId === id)?.name ?? id;
      return known.get(id) ?? { name, tag: name, logoUrl: null };
    };
  }, [teams, rivals]);
  const mine = useMemo(() => teamIdentity(myTeam), [myTeam]);

  const own = plan[active] ?? "";
  const ownIdentity = own ? identityOf(own) : null;
  const ownRow = own ? rivals.find((row) => row.teamId === own) : undefined;
  const emptyLabel = (index: number) =>
    readOnly
      ? cleared
        ? index === 0 ? t("scrims.planCleared") : "-"
        : index === 0 ? t("scrims.noOpponentSet") : t("training.scrims.noFallback")
      : index === 0 ? t("scrims.notPlanned") : t("training.scrims.noFallback");
  const playedPlan = (index: number) => readOnly && resolvedTeamId != null && (plan[index] ?? "") === resolvedTeamId;

  const pick = (teamId: string) => {
    if (disabled || own === teamId) return;
    onPick(active, teamId);
  };
  const clearPlan = () => {
    if (disabled || own === "") return;
    onPick(active, "");
  };

  const lead = (
    <div data-slot="pick-lead" className="flex min-w-0 items-center gap-2">
      <div role="group" aria-label={t("scrims.opponentPlans")} data-slot="pick-plans" className="flex gap-0.5">
        {PLANS.map((index) => {
          const id = plan[index] ?? "";
          const identity = id ? identityOf(id) : null;
          return (
            <button
              key={index}
              type="button"
              data-slot="pick-plan-tab"
              data-plan={LETTERS[index]}
              aria-pressed={active === index}
              aria-label={`${t(PLAN_KEYS[index])}: ${identity?.name ?? emptyLabel(index)}${playedPlan(index) ? `, ${t("scrims.phone.planPlayed")}` : ""}`}
              onClick={() => setActive(index)}
              className={cn(
                "flex h-[var(--hit)] items-center gap-1.5 border-b-[3px] px-2 font-heading text-section font-bold leading-none",
                FOCUS_RING,
                active === index ? "border-club text-foreground" : "border-transparent text-muted-foreground",
              )}
            >
              {LETTERS[index]}
              {identity ? <TeamShield identity={identity} size="small" /> : <EmptyShield size="small" />}
              {playedPlan(index) ? (
                <span data-slot="pick-plan-played" className="flex items-center gap-1 text-entry font-semibold text-positive">
                  <Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={3} />
                  {t("scrims.phone.planPlayed")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {readOnly ? null : (
        <button
          type="button"
          data-slot="pick-clear"
          aria-disabled={own === "" || disabled || undefined}
          onClick={clearPlan}
          className={cn(
            "flex h-[var(--hit)] shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 font-heading text-entry font-semibold aria-disabled:cursor-default aria-disabled:text-muted-foreground",
            FOCUS_RING,
          )}
        >
          <X aria-hidden="true" className="size-[1.125rem] shrink-0" />
          {t("scrims.notPlanned")}
        </button>
      )}
    </div>
  );

  const helpButton = (
    <button
      type="button"
      data-slot="pick-help"
      aria-haspopup="dialog"
      aria-label={`${t("scrims.rivalWin")} / ${t("scrims.rivalAccepts")}`}
      onClick={() => setHelpOpen(true)}
      className={cn("flex size-[var(--hit)] items-center justify-center rounded-lg text-muted-foreground", FOCUS_RING)}
    >
      <CircleHelp aria-hidden="true" className="size-6" />
    </button>
  );

  const rivalTitle = ownIdentity?.name ?? emptyLabel(active);

  return (
    <ScrimViewFrame title={slotLabel} onBack={onBack} lead={lead} actions={helpButton}>
      <div data-slot="scrim-pick-view" className="flex h-full min-h-0 flex-col gap-2 pb-3 pt-2">
        <section
          data-slot="pick-card"
          aria-label={`${mine.name} ${t("common.vs")} ${rivalTitle}`}
          className="grid min-h-[9.25rem] flex-1 grid-cols-[1fr_7rem_1fr] items-center rounded-xl bg-card px-4 py-3 text-card-foreground"
        >
          <div data-slot="pick-card-mine" className="flex min-w-0 flex-col gap-2">
            <span className="truncate font-heading text-section font-bold">{mine.name}</span>
            <div className="flex items-center gap-3">
              <TeamShield identity={mine} size="large" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {ownRow ? <Odds label={t("scrims.rivalWin")} value={ownRow.winPercent} tone="club" /> : null}
                <span className="text-caption tabular-nums text-muted-foreground">
                  {t("scrims.rivalRep")} {ownReputation}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span aria-hidden="true" className="font-heading text-title font-bold uppercase leading-none text-muted-foreground">
              {t("common.vs")}
            </span>
            <span className="font-heading text-section font-bold leading-none text-club-text">{t(PLAN_KEYS[active])}</span>
          </div>
          <div data-slot="pick-card-rival" className="flex min-w-0 flex-col items-end gap-2 text-end">
            <span className="max-w-full truncate font-heading text-section font-bold">{rivalTitle}</span>
            <div className="flex w-full flex-row-reverse items-center gap-3">
              {ownIdentity ? <TeamShield identity={ownIdentity} size="large" /> : <EmptyShield size="large" />}
              <div className="flex min-w-0 flex-1 flex-col items-end gap-1.5">
                {ownRow ? (
                  <>
                    <div className="w-full">
                      <Odds label={t("scrims.rivalAccepts")} value={ownRow.acceptPercent} tone="info" mirror />
                    </div>
                    <span className="flex gap-3 text-caption tabular-nums text-muted-foreground">
                      <span>
                        {t("common.ovr")} {ownRow.ovr}
                      </span>
                      <span>
                        {t("scrims.rivalRep")} {ownRow.reputation}
                      </span>
                    </span>
                  </>
                ) : ownIdentity || readOnly ? null : (
                  <span className="text-entry text-muted-foreground">{t("training.scrims.selectOpponent")}</span>
                )}
              </div>
            </div>
          </div>
        </section>

        <div data-slot="pick-strip-row" className="flex h-[3.625rem] shrink-0 gap-2">
          {readOnly ? (
            <p data-slot="pick-lock-note" className="m-0 w-[19rem] shrink-0 self-center text-caption leading-4 text-muted-foreground">
              {blockedText ?? t("scrims.slotStatus.locked")}
            </p>
          ) : null}
          <div
            role="group"
            aria-label={t("scrims.rivalsTable")}
            data-slot="pick-strip"
            className={cn(
              "flex min-w-0 flex-1 items-start gap-0.5 overflow-x-auto overflow-y-hidden pt-0.5",
              // Read-only nobody picks: the track would only sit over the labels.
              readOnly ? "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "scrollbar-v2",
            )}
          >
            {readOnly ? null : (
              <span className="w-14 shrink-0 self-center text-entry text-muted-foreground">{t("scrims.rivalAccepts")}</span>
            )}
            {rivals.map((row) => {
              const identity = identityOf(row.teamId);
              const chosen = own === row.teamId;
              const heldBy = plan.findIndex((id, index) => index !== active && id === row.teamId);
              const letter = chosen ? LETTERS[active] : heldBy >= 0 ? LETTERS[heldBy] : null;
              const state = chosen ? "chosen" : heldBy >= 0 ? "held" : "free";
              const cell = (
                <>
                  <span data-slot="pick-ring" className={cn("relative inline-flex size-10 shrink-0 rounded-lg", chosen && "ring-2 ring-club")}>
                    <TeamShield identity={identity} size="small" />
                    {letter ? (
                      <span
                        data-slot="pick-badge"
                        aria-hidden={readOnly ? undefined : true}
                        className={cn(
                          "absolute -end-1.5 -top-0.5 inline-flex size-5 items-center justify-center rounded-full font-heading text-caption font-bold leading-none",
                          chosen ? "bg-club text-club-foreground" : "bg-muted text-foreground",
                        )}
                      >
                        {letter}
                      </span>
                    ) : null}
                  </span>
                  <span data-slot="pick-rival-line" className="w-full truncate text-center font-heading text-caption leading-[0.875rem] tabular-nums">
                    <span className="font-semibold">{identity.tag}</span> <span className="text-muted-foreground">{row.acceptPercent}%</span>
                  </span>
                </>
              );
              const base = "relative flex w-[3.75rem] shrink-0 flex-col items-center gap-0.5 rounded-lg px-0.5";
              if (readOnly) {
                return (
                  <div key={row.teamId} data-slot="pick-rival" data-team-id={row.teamId} data-state={state} className={base}>
                    {cell}
                  </div>
                );
              }
              const held = heldBy >= 0;
              return (
                <button
                  key={row.teamId}
                  type="button"
                  data-slot="pick-rival"
                  data-team-id={row.teamId}
                  data-state={state}
                  aria-pressed={chosen}
                  aria-disabled={held || disabled || undefined}
                  aria-label={`${identity.name}, ${t("scrims.rivalAccepts")} ${row.acceptPercent}%${held ? `, ${t(PLAN_KEYS[heldBy])}` : ""}`}
                  onClick={() => !held && pick(row.teamId)}
                  className={cn(base, "min-h-[var(--hit)] aria-disabled:cursor-default focus-visible:ring-inset", FOCUS_RING)}
                >
                  {cell}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            data-slot="pick-done"
            onClick={onDone}
            className={cn("flex h-[var(--hit)] min-w-[6.5rem] shrink-0 items-center gap-2 self-center rounded-lg border border-club px-3 text-start text-club-text", FOCUS_RING)}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-heading text-section font-bold leading-none">{t("common.done")}</span>
              <span className="truncate text-caption leading-3 text-muted-foreground">{doneTo}</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
          </button>
        </div>

        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent data-slot="pick-help-dialog">
            <DialogTitle>
              {t("scrims.rivalWin")} / {t("scrims.rivalAccepts")}
            </DialogTitle>
            <DialogDescription className="mt-2">
              {t("scrims.phone.noteWinAccepts", { defaultValue: "Win is your chance to win the scrim. Accepts is the chance this rival takes a slot with two or more plans." })}
            </DialogDescription>
            {active > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("scrims.phone.notePlans", { defaultValue: "A slot with one plan always plays it, and Plan A plays if every plan declines." })}
              </p>
            ) : null}
            <DialogFooter className="mt-4 justify-end">
              <Button type="button" variant="outline" size="touch" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ScrimViewFrame>
  );
}
