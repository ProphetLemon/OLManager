import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Dices, Loader2, Pencil } from "lucide-react";

import { countryName } from "@/lib/common/countries";
import { formatVal } from "@/lib/common/helpers";
import { MAX_REROLLS, limitsFor, overrideCount, reasonKey, roleKey } from "@/lib/customTeam/founders";
import type {
  FounderAttributes,
  FounderError,
  FounderSummary,
} from "@/lib/customTeam/founders";
import { Button } from "@/ui-v2/components/ui/button";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";
import { Meter } from "@/ui-v2/components/ui/meter";
import { TagBlock } from "@/ui-v2/components/ui/tag-block";
import FounderEditDialog from "./FounderEditDialog";
import type { FoundingSquadState } from "./useFoundingSquad";

/** Attribute field to its `playerProfile.lolStats` label key. */
const ATTRIBUTE_LABELS: ReadonlyArray<readonly [keyof FounderAttributes, string]> = [
  ["mechanics", "mechanics"],
  ["laning", "laning"],
  ["teamfighting", "teamfighting"],
  ["macro_play", "macro"],
  ["consistency", "consistency"],
  ["shotcalling", "shotcalling"],
  ["champion_pool", "championPool"],
  ["discipline", "discipline"],
  ["mental_resilience", "mentalResilience"],
];

export interface FoundersStepProps {
  state: FoundingSquadState;
  /** A founder rejection that came back from creating the club, if any. */
  installError: FounderError | null;
}

export default function FoundersStep({ state, installError }: FoundersStepProps) {
  const { t, i18n } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingReroll, setConfirmingReroll] = useState(false);
  const [readyMessage, setReadyMessage] = useState("");
  const rerollRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  // "asked" once the user requests a new squad, "loading" once that load is seen
  // in flight; only then does the next ready state count as the answer to announce.
  const announceNext = useRef<"idle" | "asked" | "loading">("idle");

  const { squad, generated, status, overrides, rerollsLeft } = state;
  const editedCount = overrideCount(overrides);
  const noRerolls = rerollsLeft <= 0;
  const busy = status === "loading";

  useEffect(() => {
    if (status === "loading" && announceNext.current === "asked") announceNext.current = "loading";
    if (status === "ready" && announceNext.current === "loading") {
      announceNext.current = "idle";
      setReadyMessage(t("teamSelect.founders.reroll.ready", { count: rerollsLeft }));
    }
  }, [status, rerollsLeft, t]);

  // The confirmation appears where the user is not looking: move focus to it.
  useEffect(() => {
    if (confirmingReroll) confirmRef.current?.focus();
  }, [confirmingReroll]);

  const startReroll = () => {
    announceNext.current = "asked";
    setReadyMessage("");
    state.reroll();
    // The button that was pressed (or its group) is about to unmount or disable.
    rerollRef.current?.focus();
  };

  const closeConfirm = () => {
    setConfirmingReroll(false);
    rerollRef.current?.focus();
  };

  const handleRetry = () => {
    announceNext.current = "asked";
    setReadyMessage("");
    state.retry();
    rerollRef.current?.focus();
  };

  const handleReroll = () => {
    if (noRerolls || busy) return;
    if (editedCount > 0) setConfirmingReroll(true);
    else startReroll();
  };

  const editing = squad?.players.find((player) => player.id === editingId) ?? null;
  const editingGenerated = editing
    ? (generated?.players.find((player) => player.role === editing.role) ?? editing)
    : null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("teamSelect.founders.intro")}</p>

      {installError && <InstallError error={installError} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          ref={rerollRef}
          type="button"
          variant="outline"
          onClick={handleReroll}
          disabled={noRerolls || busy || status === "error"}
          // Stays focusable while unavailable so focus is not lost to the page.
          focusableWhenDisabled
          className="aria-disabled:opacity-50"
          aria-describedby={noRerolls ? "founders-reroll-reason" : undefined}
        >
          <Dices aria-hidden="true" />
          {noRerolls
            ? t("teamSelect.founders.reroll.none")
            : t("teamSelect.founders.reroll.action", { count: rerollsLeft })}
        </Button>
        {noRerolls && (
          <p id="founders-reroll-reason" className="text-xs text-muted-foreground">
            {t("teamSelect.founders.reroll.noneReason", { max: MAX_REROLLS })}
          </p>
        )}
      </div>

      {confirmingReroll && (
        <div
          ref={confirmRef}
          role="group"
          tabIndex={-1}
          aria-label={t("teamSelect.founders.reroll.confirmLabel")}
          aria-describedby="founders-reroll-confirm-text"
          className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
        >
          <p id="founders-reroll-confirm-text" className="text-sm text-foreground">
            {t("teamSelect.founders.reroll.confirmText")}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="club"
              onClick={() => {
                setConfirmingReroll(false);
                startReroll();
              }}
            >
              {t("teamSelect.founders.reroll.confirm")}
            </Button>
            <Button type="button" variant="ghost" onClick={closeConfirm}>
              {t("teamSelect.founders.reroll.keep")}
            </Button>
          </div>
        </div>
      )}

      {state.editsDropped && (
        <p role="status" className="flex items-start gap-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("teamSelect.founders.editsDropped")}
        </p>
      )}

      {status === "error" && (
        <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">{t("teamSelect.founders.loadFailed")}</p>
          <Button type="button" variant="outline" onClick={handleRetry}>
            {t("teamSelect.founders.retry")}
          </Button>
        </div>
      )}

      <p role="status" className="min-h-5 text-sm text-muted-foreground">
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t("teamSelect.founders.loading")}
          </span>
        ) : (
          readyMessage
        )}
      </p>

      {squad && (
        <>
          <Meter
            label={t("teamSelect.founders.budget.label")}
            value={squad.bill}
            max={squad.wage_budget}
            valueText={t("teamSelect.founders.budget.text", {
              bill: formatVal(squad.bill),
              budget: formatVal(squad.wage_budget),
            })}
            tone={squad.bill > squad.wage_budget ? "warning" : "club"}
          />

          <ol
            aria-label={t("teamSelect.founders.listLabel")}
            aria-busy={busy}
            className={busy ? "space-y-3 opacity-60" : "space-y-3"}
          >
            {squad.players.map((player) => {
              return (
                <FounderRow
                  key={player.id}
                  player={player}
                  edited={Boolean(overrides[roleKey(player.role)])}
                  language={i18n.language}
                  disabled={status !== "ready"}
                  onEdit={() => setEditingId(player.id)}
                />
              );
            })}
          </ol>
        </>
      )}

      {editing && editingGenerated && squad && (
        <FounderEditDialog
          founder={editing}
          generated={editingGenerated}
          overrides={overrides}
          allowedNationalities={squad.allowed_nationalities}
          onApply={state.applyOverrides}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function InstallError({ error }: { error: FounderError }) {
  const { t } = useTranslation();
  const text =
    error.kind === "invalid_field"
      ? t("teamSelect.founders.installFailed", {
          role: t(`onAir.roles.${error.role}`),
          field: t(`teamSelect.founders.dialog.fields.${error.field}`),
          reason: t(`teamSelect.founders.errors.${reasonKey(error.reason)}`, limitsFor(error.field)),
        })
      : t("teamSelect.founders.errors.general");
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

interface FounderRowProps {
  player: FounderSummary;
  edited: boolean;
  language: string;
  disabled: boolean;
  onEdit: () => void;
}

function FounderRow({ player, edited, language, disabled, onEdit }: FounderRowProps) {
  const { t } = useTranslation();
  const role = t(`onAir.roles.${player.role}`);
  return (
    <li className="rounded-lg border border-border bg-muted/30 p-4" data-testid={`founder-${roleKey(player.role)}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <TagBlock tone="neutral" className="w-20">
          {role}
        </TagBlock>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-lg font-bold uppercase tracking-wide text-foreground">
              {player.nick}
            </span>
            {edited && (
              <TagBlock tone="info" size="sm" slant={false}>
                {t("teamSelect.founders.edited")}
              </TagBlock>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>{player.full_name}</span>
            <span className="inline-flex items-center gap-1.5">
              <CountryFlag code={player.nationality} locale={language} className="text-base" />
              <span>{countryName(player.nationality, language)}</span>
            </span>
            <span>{t("teamSelect.founders.age", { age: player.age })}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="font-heading text-title font-bold leading-none tabular-nums text-foreground">
            <span className="sr-only">{t("teamSelect.founders.ovrLabel")} </span>
            {player.ovr}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("teamSelect.founders.wage", { value: formatVal(player.wage) })}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="touch"
          disabled={disabled}
          onClick={onEdit}
          aria-label={t("teamSelect.founders.editAria", { nick: player.nick, role })}
        >
          <Pencil aria-hidden="true" />
          {t("teamSelect.founders.edit")}
        </Button>
      </div>
      <dl
        role="group"
        aria-label={t("teamSelect.founders.attributes")}
        className="mt-3 grid grid-cols-3 gap-x-4 gap-y-1 text-xs"
      >
        {ATTRIBUTE_LABELS.map(([field, labelKey]) => (
          <div key={field} className="flex items-baseline justify-between gap-2 border-b border-line">
            <dt className="min-w-0 break-words text-muted-foreground">{t(`playerProfile.lolStats.${labelKey}`)}</dt>
            <dd className="font-bold tabular-nums text-foreground">{player.attributes[field]}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
