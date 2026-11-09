import { useId } from "react"
import { Menu } from "@base-ui/react/menu"
import { ArrowLeftRight, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { shortRoleKey, type PlayerCardModel } from "@/lib/squad/cards"
import type { LolRole } from "@/lib/home/scoreboard"
import { buttonVariants } from "@/ui-v2/components/ui/button"
import { CountryFlag } from "@/ui-v2/components/ui/country-flag"
import { ScoreNumeral } from "@/ui-v2/components/ui/score-numeral"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"
import { cn } from "@/ui-v2/lib/utils"

import { LabelledMeter } from "./LabelledMeter"
import { PlayerPortrait } from "./PlayerPortrait"

export const ROLE_DEFAULT: Record<LolRole, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUPPORT: "Support",
}

export interface SwapCandidate {
  id: string
  label: string
  disabled?: boolean
  reason?: string
}

interface PlayerCardV2Props {
  model: PlayerCardModel
  slotRole: LolRole
  selected: boolean
  onSelect: (id: string) => void
  candidates: SwapCandidate[]
  onSwap: (playerId: string) => void
  saving?: boolean
  /** The player's natural role differs from the slot he fills. */
  outOfPosition?: boolean
}

export function PlayerCardV2({
  model,
  slotRole,
  selected,
  onSelect,
  candidates,
  onSwap,
  saving = false,
  outOfPosition = false,
}: PlayerCardV2Props) {
  const { t } = useTranslation()
  const reasonId = useId()
  const roleLabel = t(shortRoleKey(slotRole), { defaultValue: ROLE_DEFAULT[slotRole] })
  const swapLabel = t("onAir.squad.swapPlayer", {
    role: roleLabel,
    defaultValue: `Swap ${roleLabel}`,
  })
  const noSubstitutes = candidates.length === 0
  const hasChips = outOfPosition || model.isImport

  return (
    <div
      data-slot="player-card"
      data-selected={selected ? "true" : "false"}
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-xl bg-card text-card-foreground",
        // Selection is never colour-only: a thicker club outline, the numeral
        // highlight and the visible Selected tag all change together.
        selected
          ? "ring-2 ring-club-text [[data-contrast=high]_&]:ring-[0.1875rem]"
          : "ring-1 ring-line",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(model.id)}
        className="flex w-full min-w-0 flex-col text-start outline-none transition-colors hover:bg-muted/30 focus-visible:ring-[0.1875rem] focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span
          data-slot="player-card-banner"
          className="relative block h-28 w-full overflow-hidden border-b border-line bg-background bg-[linear-gradient(155deg,var(--club-wash),transparent_70%)]"
        >
          <TagBlock tone="club" size="md" className="absolute start-0 top-0 z-10 px-4 text-lg">
            {roleLabel}
          </TagBlock>
          {selected ? (
            <TagBlock tone="neutral" size="sm" className="absolute end-2 top-2 z-10">
              {t("onAir.tags.selected", { defaultValue: "Selected" })}
            </TagBlock>
          ) : null}
          <PlayerPortrait
            src={model.photo}
            shape="bust"
            className="absolute bottom-0 start-3 h-[5.5rem] w-24"
          />
          <span className="absolute bottom-2 end-3.5 flex flex-col items-end gap-0.5">
            <ScoreNumeral
              value={model.ovr}
              size="ovr"
              tone="foreground"
              label={`${t("common.ovr", { defaultValue: "OVR" })} ${model.ovr}`}
              className={selected ? "text-club-secondary" : undefined}
            />
            <span aria-hidden="true" className="text-xs font-semibold text-muted-foreground">
              {t("common.ovr", { defaultValue: "OVR" })}
            </span>
          </span>
        </span>

        <span className="flex min-h-[calc(var(--hit)+0.25rem)] items-center gap-2 ps-3.5 pe-[calc(var(--hit)+0.75rem)] pt-2">
          {model.nationalityCode ? (
            <CountryFlag code={model.nationalityCode} className="text-sm" />
          ) : null}
          <span
            className="min-w-0 truncate font-heading text-title font-bold uppercase"
            title={model.name}
          >
            {model.name}
          </span>
        </span>

        <span className="grid grid-cols-2 gap-2 px-3.5 pb-2 pt-1">
          <span className="flex flex-col">
            <span className="font-heading text-section font-bold leading-tight tabular-nums">
              {model.age ?? "-"}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("onAir.squad.age", { defaultValue: "Age" })}
            </span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span
              className="truncate font-heading text-section font-bold leading-tight tabular-nums"
              title={model.wageLabel}
            >
              {model.wageCompact}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("onAir.squad.perYearLabel", { defaultValue: "per year" })}
            </span>
          </span>
        </span>

        {hasChips ? (
          <span className="flex flex-wrap items-center gap-1.5 px-3.5 pb-2">
            {outOfPosition ? (
              <TagBlock tone="warning" size="sm">
                {t("squad.outOfPosition", { defaultValue: "Out of position" })}
              </TagBlock>
            ) : null}
            {model.isImport ? (
              <span data-testid="import-badge" className="inline-flex">
                <TagBlock tone="info" size="sm">
                  {t("squad.importBadge", { defaultValue: "Import" })}
                </TagBlock>
              </span>
            ) : null}
          </span>
        ) : null}
      </button>

      <div className="flex flex-col gap-1 px-3.5 pb-3.5">
        <LabelledMeter label={t("onAir.squad.energy", { defaultValue: "Energy" })} value={model.energy} />
        <LabelledMeter label={t("onAir.squad.morale", { defaultValue: "Morale" })} value={model.morale} />
        {model.fitness !== null ? (
          <LabelledMeter
            label={t("onAir.squad.fitness", { defaultValue: "Fitness" })}
            value={model.fitness}
          />
        ) : null}
      </div>

      {noSubstitutes ? (
        // aria-disabled (not disabled) keeps the control focusable so the reason is reachable.
        <>
          <button
            type="button"
            aria-label={swapLabel}
            aria-disabled="true"
            aria-describedby={reasonId}
            title={t("onAir.squad.swapUnavailable", {
              defaultValue: "No substitutes available to swap in",
            })}
            className={cn(
              buttonVariants({ variant: "outline", size: "icon-touch" }),
              "absolute end-2 top-[7.125rem] cursor-not-allowed opacity-60 hover:bg-background",
            )}
          >
            <ArrowLeftRight aria-hidden="true" />
          </button>
          <span id={reasonId} className="sr-only">
            {t("onAir.squad.swapUnavailable", {
              defaultValue: "No substitutes available to swap in",
            })}
          </span>
        </>
      ) : (
        <Menu.Root>
          <Menu.Trigger
            aria-label={swapLabel}
            aria-busy={saving || undefined}
            disabled={saving}
            title={swapLabel}
            className={cn(
              buttonVariants({ variant: "outline", size: "icon-touch" }),
              "absolute end-2 top-[7.125rem]",
            )}
          >
            {saving ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <ArrowLeftRight aria-hidden="true" />
            )}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={4} className="z-50">
              <Menu.Popup
                aria-label={swapLabel}
                className="max-h-72 min-w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
              >
                {candidates.map((candidate) => (
                  <Menu.Item
                    key={candidate.id}
                    disabled={candidate.disabled}
                    onClick={() => onSwap(candidate.id)}
                    className="flex min-h-[var(--hit)] cursor-default flex-col justify-center rounded-md px-3 py-1 text-sm outline-none data-[disabled]:opacity-70 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
                  >
                    <span className="font-semibold">{candidate.label}</span>
                    {candidate.disabled && candidate.reason ? (
                      <span className="text-xs text-muted-foreground">{candidate.reason}</span>
                    ) : null}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  )
}
