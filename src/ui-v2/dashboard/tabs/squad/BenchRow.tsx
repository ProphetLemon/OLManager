import { Repeat, ShoppingCart } from "lucide-react"
import { useTranslation } from "react-i18next"

import { shortRoleKey, type PlayerCardModel } from "@/lib/squad/cards"
import { PlayerAvatar } from "@/ui-v2/_legacy/components/ui/PlayerAvatar"
import { Button } from "@/ui-v2/components/ui/button"
import { Meter } from "@/ui-v2/components/ui/meter"
import { ScoreNumeral } from "@/ui-v2/components/ui/score-numeral"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"

import { ROLE_DEFAULT } from "./PlayerCardV2"

interface BenchRowProps {
  model: PlayerCardModel
  loanListed: boolean
  onOpen: (id: string) => void
  onToggleTransfer: (id: string) => void
  onToggleLoan: (id: string) => void
}

/**
 * One bench player. The row is a sibling set of controls, never a button wrapping
 * buttons: the main button opens the profile, the two toggles sit beside it. Stats
 * appear by the width of the list (container query), so nothing overlaps when the
 * rail, UI scale or window shrink.
 */
export function BenchRow({ model, loanListed, onOpen, onToggleTransfer, onToggleLoan }: BenchRowProps) {
  const { t } = useTranslation()
  const roleLabel = t(shortRoleKey(model.role), { defaultValue: ROLE_DEFAULT[model.role] })
  const transferLabel = model.transferListed
    ? t("squad.removeFromTransferList", { defaultValue: "Remove from transfer list" })
    : t("squad.addToTransferList", { defaultValue: "Add to transfer list" })
  const loanLabel = loanListed
    ? t("squad.removeFromLoanList", { defaultValue: "Remove from loan list" })
    : t("squad.addToLoanList", { defaultValue: "Add to loan list" })

  return (
    <li
      data-slot="bench-row"
      className="flex items-center gap-2 border-b border-line pe-2 last:border-b-0 hover:bg-muted/40"
    >
      <button
        type="button"
        onClick={() => onOpen(model.id)}
        className="flex min-h-[var(--hit)] min-w-0 flex-1 items-center gap-3 px-3 py-2 text-start outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring focus-visible:ring-inset"
      >
        <TagBlock tone="secondary" size="sm" className="shrink-0">
          {roleLabel}
        </TagBlock>
        <PlayerAvatar src={model.photo} alt="" className="size-10 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-heading text-lg font-bold" title={model.name}>
            {model.name}
          </span>
          {model.isImport ? (
            <span data-testid="import-badge" className="inline-flex">
              <TagBlock tone="info" size="sm">
                {t("squad.importBadge", { defaultValue: "Import" })}
              </TagBlock>
            </span>
          ) : null}
          {model.transferListed ? (
            <TagBlock tone="warning" size="sm">
              {t("onAir.squad.transferListedTag", { defaultValue: "Transfer listed" })}
            </TagBlock>
          ) : null}
          {loanListed ? (
            <TagBlock tone="info" size="sm">
              {t("onAir.squad.loanListedTag", { defaultValue: "Loan listed" })}
            </TagBlock>
          ) : null}
        </span>
        <ScoreNumeral
          value={model.ovr}
          size="title"
          tone="club"
          label={`${t("common.ovr", { defaultValue: "OVR" })} ${model.ovr}`}
        />
        <span className="hidden w-12 shrink-0 flex-col text-center @4xl:flex">
          <span className="font-semibold tabular-nums">{model.age ?? "-"}</span>
          <span className="text-xs text-muted-foreground">
            {t("onAir.squad.age", { defaultValue: "Age" })}
          </span>
        </span>
        <span className="hidden w-24 shrink-0 flex-col text-end @4xl:flex">
          <span className="font-semibold tabular-nums">{model.wageLabel}</span>
          <span className="text-xs text-muted-foreground">
            {t("onAir.squad.perYear", { defaultValue: "/yr" })}
          </span>
        </span>
      </button>
      <div className="hidden w-36 shrink-0 flex-col gap-1 @2xl:flex">
        <Meter size="sm" label={t("onAir.squad.energy", { defaultValue: "Energy" })} value={model.energy} />
        <Meter size="sm" label={t("onAir.squad.morale", { defaultValue: "Morale" })} value={model.morale} />
        {model.fitness !== null ? (
          <Meter size="sm" label={t("onAir.squad.fitness", { defaultValue: "Fitness" })} value={model.fitness} />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          aria-pressed={model.transferListed}
          aria-label={`${transferLabel}: ${model.name}`}
          title={transferLabel}
          className="aria-pressed:border-club-text aria-pressed:bg-muted"
          onClick={() => onToggleTransfer(model.id)}
        >
          <ShoppingCart aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          aria-pressed={loanListed}
          aria-label={`${loanLabel}: ${model.name}`}
          title={loanLabel}
          className="aria-pressed:border-club-text aria-pressed:bg-muted"
          onClick={() => onToggleLoan(model.id)}
        >
          <Repeat aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}
