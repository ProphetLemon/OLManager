import { Fragment } from "react"
import { useTranslation } from "react-i18next"

import type { StandingsPanelData } from "@/lib/home/standings"
import { ClubShield } from "@/ui-v2/components/ui/club-shield"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"
import { cn } from "@/ui-v2/lib/utils"

export interface StandingsPanelProps {
  data: StandingsPanelData
  onOpenTeams: () => void
}

/** Compact league table for Home: user row emphasised, gap divider when the user sits below the cut. */
export function StandingsPanel({ data, onOpenTeams }: StandingsPanelProps) {
  const { t } = useTranslation()
  const title = t("onAir.home.standingsTitle", { defaultValue: "Standings" })
  const won = t("common.won", { defaultValue: "W" })
  const lost = t("common.lost", { defaultValue: "L" })
  const subtitle = [data.competitionName, data.season != null ? String(data.season) : null]
    .filter(Boolean)
    .join(" ")

  return (
    <section
      data-slot="standings-panel"
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 text-card-foreground"
    >
      <header className="flex flex-col gap-0.5">
        <h2 className="font-heading text-section font-semibold leading-tight">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        {data.preseason ? (
          <p data-slot="standings-preseason" className="text-sm text-dim">
            {t("onAir.home.standingsPreseason", { defaultValue: "Season not started" })}
          </p>
        ) : null}
      </header>

      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{`${title}: ${subtitle}`}</caption>
        <thead>
          <tr className="border-b border-line text-start text-xs text-muted-foreground">
            <th scope="col" className="w-8 py-1.5 pe-2 text-end font-medium">
              <span aria-hidden="true">#</span>
              <span className="sr-only">{t("onAir.home.position", { defaultValue: "Position" })}</span>
            </th>
            <th scope="col" className="py-1.5 text-start font-medium">
              {t("common.team", { defaultValue: "Team" })}
            </th>
            <th scope="col" className="py-1.5 ps-2 text-end font-medium">
              {`${won}-${lost}`}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <Fragment key={row.teamId}>
              {data.gapBefore === index ? (
                <tr data-slot="standings-gap">
                  <td colSpan={3} className="h-5 py-0">
                    <span className="sr-only">
                      {t("onAir.home.standingsGap", { defaultValue: "Gap in the table" })}
                    </span>
                    <span aria-hidden="true" className="block border-t border-dashed border-line" />
                  </td>
                </tr>
              ) : null}
              <tr
                aria-current={row.isMe ? "true" : undefined}
                data-me={row.isMe ? "true" : undefined}
                className={cn(
                  "h-[2.375rem] border-b border-line/60 last:border-b-0",
                  row.isMe && "bg-club-wash font-bold shadow-[inset_0.1875rem_0_0_var(--club-text)]"
                )}
              >
                <td className="w-8 pe-2 text-end tabular-nums">{row.position}</td>
                <td className="max-w-0 py-1">
                  <button
                    type="button"
                    onClick={onOpenTeams}
                    title={row.name}
                    className="flex min-h-6 w-full min-w-0 items-center gap-2 rounded-md text-start hover:underline"
                  >
                    <ClubShield name={row.name} logoUrl={row.logoUrl} size="sm" />
                    <span className="shrink-0 font-heading text-base font-semibold">{row.shortName}</span>
                    <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                      {row.name}
                    </span>
                    {row.isMe ? (
                      <TagBlock tone="club" size="sm">
                        {t("onAir.tags.you", { defaultValue: "You" })}
                      </TagBlock>
                    ) : null}
                    {row.movement === "promoted" ? (
                      <TagBlock tone="positive" size="sm">
                        {t("onAir.tags.promoted", { defaultValue: "Promoted" })}
                      </TagBlock>
                    ) : null}
                  </button>
                </td>
                <td className="ps-2 text-end tabular-nums">{`${row.won}-${row.lost}`}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  )
}
