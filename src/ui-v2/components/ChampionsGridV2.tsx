import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ChampionData } from "@/store/types";
import { resolveChampionTile } from "@/lib/champions/championImages";
import { cn } from "@/ui-v2/lib/utils";
import championsSeed from "../../../assets/simulation/champions.json";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";

type ChampionRolesMap = Record<string, string[]>;
const CHAMPION_ROLES: ChampionRolesMap =
  ((championsSeed as { data?: { roles?: ChampionRolesMap } }).data?.roles ?? {}) as ChampionRolesMap;

interface ChampionsGridV2Props {
  champions?: ChampionData[];
  onChampionClick: (championKey: string) => void;
}

type DraftRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

const LOL_ROLE_ORDER: DraftRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
const PAGE_SIZE = 48;

const LOL_ROLE_ICON_URLS: Record<string, string> = {
  TOP: ROLE_ICON_PATHS.TOP,
  JUNGLE: ROLE_ICON_PATHS.JUNGLE,
  MID: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  SUPPORT: ROLE_ICON_PATHS.SUPPORT,
};

function normalizeRole(role: string): DraftRole {
  return role === "Bot" ? "ADC" : role.toUpperCase() as DraftRole;
}

export default function ChampionsGridV2({ champions, onChampionClick }: ChampionsGridV2Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | DraftRole>("ALL");
  const [page, setPage] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Staggered reveal on mount
  useEffect(() => { setVisible(true); }, []);

  const filtered = useMemo(() => {
    if (!champions) return [];
    const q = search.trim().toLowerCase();
    return champions
      .filter((c) => {
        if (q && !c.name.toLowerCase().includes(q) && !c.champion_key.toLowerCase().includes(q)) return false;
        if (roleFilter !== "ALL") {
          return (CHAMPION_ROLES[c.champion_key] ?? []).some((r) => normalizeRole(r) === roleFilter);
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [champions, search, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const handleClick = useCallback((key: string) => onChampionClick(key), [onChampionClick]);

  const resetPage = () => setPage(0);

  if (!champions || champions.length === 0) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* Search & filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="relative flex h-9 min-w-48 flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            placeholder={t("champions.searchPlaceholder", "Buscar campeón...")}
            className="h-full w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50 focus:bg-muted/50"
          />
        </div>

        <div className="flex gap-1.5">
          <RoleButton
            active={roleFilter === "ALL"}
            onClick={() => { setRoleFilter("ALL"); resetPage(); }}
            title={t("common.all", "All")}
          >
            <span className="font-heading text-2xs font-bold uppercase tracking-widest">All</span>
          </RoleButton>
          {LOL_ROLE_ORDER.map((role) => (
            <RoleButton
              key={role}
              active={roleFilter === role}
              onClick={() => { setRoleFilter(roleFilter === role ? "ALL" : role); resetPage(); }}
              title={role}
            >
              <img src={LOL_ROLE_ICON_URLS[role]} alt={role} className="size-4 object-contain" />
            </RoleButton>
          ))}
        </div>

        <span className="text-xs tabular-nums text-muted-foreground/60">
          {t("championsGrid.championCount", { count: filtered.length, defaultValue: "{{count}} champions" })}
        </span>
      </div>

      {/* Champion grid */}
      {paginated.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-v2">
          <div
            ref={gridRef}
            className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
          >
          {paginated.map((champion, i) => {
            const roles = CHAMPION_ROLES[champion.champion_key] ?? [];
            const tile = resolveChampionTile(champion.champion_key);
            return (
              <button
                key={champion.id}
                type="button"
                onClick={() => handleClick(champion.champion_key)}
                className={cn(
                  "group relative aspect-[3/4] overflow-hidden rounded-lg border border-border/60 bg-card transition-all duration-200",
                  "hover:z-10 hover:scale-[1.08] hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10",
                  visible && "animate-fade-in-up",
                )}
                style={{ animationDelay: `${(i % 20) * 25}ms` }}
              >
                {tile && (
                  <img
                    src={tile}
                    alt={champion.name}
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-110"
                    loading="lazy"
                  />
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2 py-2">
                  <p className="truncate text-center font-heading text-caption font-bold uppercase tracking-wider text-white drop-shadow">
                    {champion.champion_key}
                  </p>
                </div>
                {roles.length > 0 && (
                  <div className="pointer-events-none absolute left-1.5 top-1.5 flex flex-col gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {roles.map((role) => {
                      const norm = normalizeRole(role);
                      const icon = LOL_ROLE_ICON_URLS[norm];
                      return icon ? (
                        <span
                          key={role}
                          className="flex size-4 items-center justify-center rounded-sm bg-black/60"
                          title={role}
                        >
                          <img src={icon} alt={role} className="size-3 object-contain" />
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        </div>
      ) : (
        <div className="flex shrink-0 flex-col items-center justify-center py-16">
          <p className="font-heading text-sm uppercase tracking-wider text-muted-foreground">
            {t("championsGrid.noResults")}
          </p>
          <button
            type="button"
            onClick={() => { setSearch(""); setRoleFilter("ALL"); }}
            className="mt-2 text-xs text-primary hover:underline"
          >
            {t("championsGrid.clearFilters")}
          </button>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t border-border pt-4">
          <p className="font-heading text-xs tabular-nums text-muted-foreground">
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} de {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <PageBtn disabled={safePage === 0} onClick={() => setPage(0)}>
              <ChevronsLeft className="size-4" />
            </PageBtn>
            <PageBtn disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft className="size-4" />
            </PageBtn>
            <span className="min-w-[4rem] text-center font-heading text-xs font-bold tabular-nums text-foreground">
              {safePage + 1} / {totalPages}
            </span>
            <PageBtn disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
              <ChevronRight className="size-4" />
            </PageBtn>
            <PageBtn disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
              <ChevronsRight className="size-4" />
            </PageBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleButton({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex size-9 items-center justify-center rounded-lg border text-xs font-medium transition-all",
        active
          ? "border-primary bg-primary/10 text-primary shadow-sm shadow-primary/10"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PageBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
