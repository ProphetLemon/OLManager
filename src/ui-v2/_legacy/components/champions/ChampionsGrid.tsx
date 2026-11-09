import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter } from "lucide-react";
import type { ChampionData } from "@/store/types";
import { Card, CardBody } from "@/ui-v2/_legacy/components/ui";
import { resolveChampionTile } from "@/lib/champions/championImages";
import championsSeed from "../../../../../assets/simulation/champions.json";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";

type ChampionRolesMap = Record<string, string[]>;
const CHAMPION_ROLES: ChampionRolesMap =
  ((championsSeed as { data?: { roles?: ChampionRolesMap } }).data?.roles ?? {}) as ChampionRolesMap;

interface ChampionsGridProps {
  champions?: ChampionData[];
  onChampionClick: (championKey: string) => void;
}

type DraftRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

const LOL_ROLE_ORDER: DraftRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
const PAGE_SIZE = 30;

const LOL_ROLE_ICON_URLS: Record<string, string> = {
  TOP: ROLE_ICON_PATHS.TOP,
  JUNGLE: ROLE_ICON_PATHS.JUNGLE,
  MID: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  SUPPORT: ROLE_ICON_PATHS.SUPPORT,
};

const ROLE_BADGE_STYLES: Record<DraftRole, string> = {
  TOP: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  JUNGLE: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  MID: "bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300",
  ADC: "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
  SUPPORT: "bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-400",
};
export default function ChampionsGrid({ champions, onChampionClick }: ChampionsGridProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | DraftRole>("ALL");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const toggleSort = () => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));

  const filtered = useMemo(() => {
    if (!champions) return [];
    const q = search.trim().toLowerCase();
    return champions
      .filter((c) => {
        if (q && !c.name.toLowerCase().includes(q) && !c.champion_key.toLowerCase().includes(q)) return false;
        if (roleFilter !== "ALL") {
          const roles = CHAMPION_ROLES[c.champion_key] ?? [];
          if (!roles.some((r) => r === "Bot" ? roleFilter === "ADC" : r.toUpperCase() === roleFilter)) return false;
        }
        return true;
      })
      .sort((a, b) => sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  }, [champions, search, roleFilter, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const paginated = filtered.slice(pageStart, pageEnd);

  const handleClick = useCallback(
    (championKey: string) => onChampionClick(championKey),
    [onChampionClick],
  );

  if (!champions || champions.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Search + Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t("champions.searchPlaceholder", "Buscar campeón...")}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white dark:bg-navy-800 border border-gray-200 dark:border-navy-600 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => { setRoleFilter("ALL"); setPage(0); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all ${roleFilter === "ALL" ? "bg-primary-500 text-white shadow-sm" : "bg-white dark:bg-navy-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-navy-600"}`}
          >
            <img src="/role-icons/allroles.webp" alt="All" className="h-3.5 w-3.5" />
          </button>
          {LOL_ROLE_ORDER.map((role) => (
            <button
              key={role}
              onClick={() => { setRoleFilter(roleFilter === role ? "ALL" : role); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all ${roleFilter === role ? "bg-primary-500 text-white shadow-sm" : "bg-white dark:bg-navy-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-navy-600"}`}
            >
              <img src={LOL_ROLE_ICON_URLS[role]} alt={role} className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider">
        <Filter className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
        {filtered.length} {t("champions.results", "campeón(es) encontrado(s)")}
      </p>

      {/* Table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-navy-800 border-b border-gray-200 dark:border-navy-600 text-xs">
                  <th className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 w-14" />
                  <th
                    className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-800 dark:hover:text-gray-300 transition-colors"
                    onClick={toggleSort}
                  >
                    <span className="inline-flex items-center gap-1">
                      {t("champions.name", "Campeón")}
                      {sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                    </span>
                  </th>
                  <th className="py-3 px-4 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("champions.roles", "Roles")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
                {paginated.map((champion) => {
                  const roles = CHAMPION_ROLES[champion.champion_key] ?? [];
                  return (
                    <tr
                      key={champion.id}
                      onClick={() => handleClick(champion.champion_key)}
                      className="hover:bg-gray-50 dark:hover:bg-navy-700/50 transition-colors cursor-pointer group"
                    >
                      <td className="py-2.5 px-4">
                        <img
                          src={resolveChampionTile(champion.champion_key) ?? ""}
                          alt={champion.name}
                          className="w-8 h-8 rounded-lg object-cover bg-gray-200 dark:bg-navy-600"
                          loading="lazy"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="font-semibold text-sm text-gray-800 dark:text-gray-200 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                          {champion.champion_key}
                        </p>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex gap-1.5">
                          {roles.map((role) => {
                            const normalized = role === "Bot" ? "ADC" : role.toUpperCase() as DraftRole;
                            const iconUrl = LOL_ROLE_ICON_URLS[normalized];
                            const badgeStyle = ROLE_BADGE_STYLES[normalized] ?? "bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-400";
                            if (!iconUrl) return null;
                            return (
                              <span
                                key={role}
                                className={`inline-flex items-center gap-1 font-bold font-heading uppercase tracking-wider rounded-md px-2 py-0.5 text-2xs ${badgeStyle}`}
                                title={role}
                              >
                                <img src={iconUrl} alt={role} className="h-3 w-3" />
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-navy-600">
            <p className="text-xs text-gray-400 dark:text-gray-500 font-heading">
              {pageStart + 1}–{pageEnd} {t("champions.of", "de")} {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                disabled={safePage === 0}
                onClick={() => setPage(0)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-navy-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-navy-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1 text-xs font-heading font-bold text-gray-600 dark:text-gray-300">
                {safePage + 1} / {totalPages}
              </span>
              <button
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-navy-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(totalPages - 1)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-navy-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

