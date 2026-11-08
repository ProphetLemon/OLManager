import { useMemo, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Globe, Search, Users, X } from "lucide-react";
import type { CompetitionSummary } from "@/store/gameStore";
import { cn } from "@/ui-v2/lib/utils";
import { useRovingFocus } from "@/hooks/useRovingFocus";
import { groupLeaguesByTier } from "@/lib/world/leagueGroups";

interface LeaguePickerV2Props {
  competitions: CompetitionSummary[];
  onSelect: (id: string) => void;
}

const REGION_BG: Record<string, string> = {
  "LEC": "from-blue-600/30 via-blue-800/10 to-transparent",
  "LCS": "from-red-600/30 via-red-800/10 to-transparent",
  "LCK": "from-green-600/30 via-green-800/10 to-transparent",
  "LPL": "from-yellow-500/30 via-yellow-700/10 to-transparent",
  "LCP": "from-purple-600/30 via-purple-800/10 to-transparent",
  "CBLOL": "from-emerald-600/30 via-emerald-800/10 to-transparent",
};

export function LeaguePickerV2({ competitions, onSelect }: LeaguePickerV2Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return competitions;
    const q = query.toLowerCase();
    return competitions.filter(
      (c) => c.name.toLowerCase().includes(q) || c.region.toLowerCase().includes(q),
    );
  }, [competitions, query]);

  const groups = useMemo(() => groupLeaguesByTier(filtered), [filtered]);
  // Keyboard navigation follows the on-screen order: main leagues, then regional ones.
  const ordered = useMemo(() => [...groups.main, ...groups.regional], [groups]);

  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { activeIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: ordered.length,
    columns: 2,
    onSelect: (i) => onSelect(ordered[i]?.id),
    getItemLabel: (i) => ordered[i]?.name ?? "",
  });

  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  const renderCard = (comp: CompetitionSummary, i: number) => {
    const region = Object.keys(REGION_BG).find((k) => comp.name.toUpperCase().includes(k) || comp.region.toUpperCase().includes(k));
    const bgGradient = region ? REGION_BG[region] : "from-primary/20 via-primary/5 to-transparent";

    return (
      <button
        key={comp.id}
        ref={(el) => { itemRefs.current[i] = el; }}
        tabIndex={getTabIndex(i)}
        type="button"
        onClick={() => onSelect(comp.id)}
        className={cn(
          "group relative overflow-hidden rounded-xl border border-border bg-card p-6 text-left transition-all duration-300 animate-fade-in-up",
          "hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5",
        )}
        style={{ animationDelay: `${i * 60}ms` }}
      >
        {/* Regional gradient glow */}
        <div className={cn("absolute -right-20 -top-20 size-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100", bgGradient.replace("from-", "bg-").split("/")[0]?.replace("from-", "bg-") ?? "bg-primary/10")} />
        <div className={cn("absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-500 group-hover:opacity-100", bgGradient)} />

        <div className="relative z-10 flex items-start gap-4">
          <div className={cn(
            "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 transition-all duration-300",
            "bg-muted group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10"
          )}>
            {comp.logo ? (
              <img src={comp.logo} alt={comp.name} className="size-10 object-contain" />
            ) : (
              <Globe className="size-6 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-heading text-base font-bold uppercase tracking-wide text-foreground group-hover:text-primary transition-colors">
              {comp.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{comp.region}</p>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground/60">
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" />
                {comp.team_count} {t("teamSelect.teams", "teams")}
              </span>
              <ChevronRight className="size-3.5 opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100" />
            </div>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-6 pt-4 md:px-8 md:pt-6">
        <div className="relative mx-auto max-w-2xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("teamSelect.searchLeague", "Search leagues...")}
            className="h-10 w-full rounded-lg border border-border bg-muted/50 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground/40 transition-colors focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div
        className="flex-1 overflow-y-auto p-6 md:p-8 scrollbar-v2"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        {filtered.length === 0 ? (
          <div className="mx-auto max-w-2xl py-16 text-center">
            <Search className="mx-auto mb-3 size-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/60">{t("teamSelect.noLeaguesMatch", "No leagues match your search")}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-8">
            {groups.main.length > 0 && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {groups.main.map((comp, i) => renderCard(comp, i))}
              </div>
            )}
            {groups.regional.length > 0 && (
              <section className="space-y-4">
                <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  {t("teamSelect.regionalLeagues", "Regional leagues")}
                </h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {groups.regional.map((comp, i) => renderCard(comp, groups.main.length + i))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
