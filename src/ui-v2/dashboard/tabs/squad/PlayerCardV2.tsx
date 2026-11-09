import { Menu } from "@base-ui/react/menu"
import { ArrowLeftRight, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { shortRoleKey, type PlayerCardModel } from "@/lib/squad/cards"
import type { LolRole } from "@/lib/home/scoreboard"
import { PlayerAvatar } from "@/ui-v2/_legacy/components/ui/PlayerAvatar"
import { buttonVariants } from "@/ui-v2/components/ui/button"
import { CountryFlag } from "@/ui-v2/components/ui/country-flag"
import { Meter } from "@/ui-v2/components/ui/meter"
import { ScoreNumeral } from "@/ui-v2/components/ui/score-numeral"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"
import { cn } from "@/ui-v2/lib/utils"

const ROLE_DEFAULT: Record<LolRole, string> = {
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
}

export function PlayerCardV2({
  model,
  slotRole,
  selected,
  onSelect,
  candidates,
  onSwap,
  saving = false,
}: PlayerCardV2Props) {
  const { t } = useTranslation()
  const roleLabel = t(shortRoleKey(slotRole), { defaultValue: ROLE_DEFAULT[slotRole] })
  const swapLabel = t("onAir.squad.swapPlayer", {
    role: roleLabel,
    defaultValue: `Swap ${roleLabel}`,
  })

  return (
    <div
      data-slot="player-card"
      data-selected={selected ? "true" : "false"}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl bg-card text-card-foreground",
        // Selection is never colour-only: a thicker ring plus the visible Selected tag.
        selected ? "ring-[0.1875rem] ring-club-text" : "ring-1 ring-line",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(model.id)}
        className="flex min-h-[var(--hit)] w-full min-w-0 flex-col gap-2 p-3 text-start outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[0.1875rem] focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <TagBlock tone={selected ? "club" : "secondary"} size="sm">
            {roleLabel}
          </TagBlock>
          {selected ? (
            <TagBlock tone="neutral" size="sm">
              {t("onAir.tags.selected", { defaultValue: "Selected" })}
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
        <span className="flex items-center gap-3">
          <PlayerAvatar src={model.photo} alt="" className="size-12" />
          <ScoreNumeral value={model.ovr} size="ovr" tone="club" />
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {model.nationalityCode ? (
            <CountryFlag code={model.nationalityCode} className="text-sm" />
          ) : null}
          <span className="truncate font-heading text-lg font-bold" title={model.name}>
            {model.name}
          </span>
        </span>
      </button>

      <div className="flex flex-col gap-1.5 px-3 pb-2">
        <Meter
          size="sm"
          label={t("onAir.squad.energy", { defaultValue: "Energy" })}
          value={model.energy}
        />
        <Meter
          size="sm"
          label={t("onAir.squad.morale", { defaultValue: "Morale" })}
          value={model.morale}
        />
        {model.fitness !== null ? (
          <Meter
            size="sm"
            label={t("onAir.squad.fitness", { defaultValue: "Fitness" })}
            value={model.fitness}
          />
        ) : null}
      </div>

      <Menu.Root>
        <Menu.Trigger
          aria-label={swapLabel}
          aria-busy={saving || undefined}
          disabled={saving || candidates.length === 0}
          className={cn(
            buttonVariants({ variant: "outline", size: "touch" }),
            "m-3 mt-1 gap-2 self-stretch",
          )}
        >
          {saving ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <ArrowLeftRight aria-hidden="true" />
          )}
          {t("onAir.squad.swap", { defaultValue: "Swap" })}
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
    </div>
  )
}
