import type { OpponentIntelSnapshot } from "@/ui-v2/_legacy/components/match/opponentIntelService";
import { useTranslation } from "react-i18next";

import { shortRoleKey } from "@/lib/squad/cards";
import type { LolRole } from "@/lib/home/scoreboard";
import { formatDecimal } from "@/lib/formatting/decimalFormatting";

const LOL_ROLES: readonly string[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

export default function OpponentIntelCard({ intel }: { intel: OpponentIntelSnapshot }) {
  const { t, i18n } = useTranslation();
  // The intel service reports a role name from the seed data, or "Unknown" when it has none.
  const roleLabel = (role: string): string => {
    const upper = role.toUpperCase();
    if (LOL_ROLES.includes(upper)) {
      return t(shortRoleKey(upper as LolRole), { defaultValue: role });
    }
    return role === "Unknown" ? t("match.opponentIntel.roleUnknown", { defaultValue: role }) : role;
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-heading">{t("match.opponentIntel.kicker", "Pre-match preparation")}</p>
          <h3 className="font-heading text-lg font-bold text-foreground">{t("match.opponentIntel.title", "Opponent intelligence")}</h3>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{t("match.opponentIntel.confidence", "Intel confidence")}</p>
          <p className="font-heading font-bold text-sm text-club-text">
            {t(`match.opponentIntel.quality.${intel.confidence.qualityLabel}`, { defaultValue: intel.confidence.qualityLabel }).toLocaleUpperCase(i18n.language)} · {intel.confidence.poolCoveragePct}%
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-3">
          <h4 className="text-xs uppercase tracking-wider font-heading text-muted-foreground">{t("match.opponentIntel.rivalPoolByRole", "Rival champion pool by role")}</h4>
          {intel.playerPools.map((pool) => (
            <div key={`${pool.playerName}-${pool.role}`} className="rounded-xl border border-border p-3">
              <p className="text-sm font-semibold text-foreground">{pool.playerName} <span className="text-xs text-muted-foreground">({roleLabel(pool.role)})</span></p>
              <div className="mt-2 flex flex-wrap gap-2">
                {pool.champions.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("match.opponentIntel.noPoolYet", "No champion pool revealed yet.")}</span>
                ) : pool.champions.map((champion) => (
                  <span key={`${pool.playerName}-${champion.championId}`} className="text-xs px-2 py-1 rounded-lg bg-muted text-foreground">
                    {champion.championName} · {Math.round(champion.mastery)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <h4 className="text-xs uppercase tracking-wider font-heading text-muted-foreground">{t("match.opponentIntel.suggestedBans", "Suggested bans")}</h4>
          <div className="rounded-xl border border-border p-3">
            <ul className="space-y-2">
              {intel.suggestedBans.map((ban) => (
                <li key={`ban-${ban.championId}`} className="flex justify-between text-sm text-foreground">
                  <span>{ban.championName}</span>
                  <span className="text-xs text-muted-foreground">{t("match.opponentIntel.threat", "Threat")} {formatDecimal(ban.threatScore, 1, i18n.language)}</span>
                </li>
              ))}
            </ul>
          </div>

          <h4 className="text-xs uppercase tracking-wider font-heading text-muted-foreground">{t("match.opponentIntel.metaThreats", "Meta threats")}</h4>
          <div className="rounded-xl border border-border p-3">
            <ul className="space-y-2">
              {intel.metaThreats.map((champion) => (
                <li key={`meta-${champion.championId}`} className="flex justify-between text-sm text-foreground">
                  <span>{champion.championName}</span>
                  <span className="text-xs text-muted-foreground">{t("match.opponentIntel.meta", "Meta")} {champion.metaScore}</span>
                </li>
              ))}
            </ul>
          </div>

          <h4 className="text-xs uppercase tracking-wider font-heading text-muted-foreground">{t("match.opponentIntel.masteryHighlights", "Mastery highlights")}</h4>
          <div className="rounded-xl border border-border p-3 flex flex-wrap gap-2">
            {intel.masteryHighlights.map((champion) => (
              <span key={`mastery-${champion.championId}`} className="text-xs px-2 py-1 rounded-lg bg-primary/10 text-club-text">
                {champion.championName} · {Math.round(champion.mastery)}%
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

