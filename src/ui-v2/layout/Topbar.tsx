import { useTranslation } from "react-i18next";
import { Link, useMatches } from "react-router-dom";
import { Search } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/ui-v2/components/ui/breadcrumb";

type Crumb = { label: string; to?: string };

export function Topbar() {
  const { t } = useTranslation();
  const matches = useMatches();
  const crumbs: Crumb[] = matches
    .filter((m) => (m.handle as { crumb?: string } | undefined)?.crumb)
    .map((m) => ({
      label: (m.handle as { crumb: string }).crumb,
      to: m.pathname,
    }));

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background/60 px-6 backdrop-blur">
      <Breadcrumb aria-label={t("common.breadcrumb")}>
        <BreadcrumbList>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <BreadcrumbItem key={c.to ?? c.label}>
                {last || !c.to ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link to={c.to} />}>
                    {c.label}
                  </BreadcrumbLink>
                )}
                {!last && <BreadcrumbSeparator />}
              </BreadcrumbItem>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <button
        type="button"
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t("common.search")}
      >
        <Search className="size-4" />
      </button>
    </header>
  );
}
