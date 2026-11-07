import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { RosterOverlayStatus } from "@/hooks/useRosterOverlay";
import { formatDate } from "@/lib/formatting/dateFormatting";
import type { WorldOverlayInfo } from "@/services/worldOverlayService";
import { Button } from "@/ui-v2/components/ui/button";

interface RosterOverlayPanelProps {
  info: WorldOverlayInfo | null;
  status: RosterOverlayStatus;
  error: string | null;
  onUpdate: () => void;
}

/**
 * Licence links are never taken from the overlay: only these exact URLs, which
 * are also the ones allowed by the opener capability, can be linked.
 */
const FANDOM_LICENSING_URL = "https://www.fandom.com/licensing";
const CC_BY_SA_3_URL = "https://creativecommons.org/licenses/by-sa/3.0/";
const ALLOWED_LICENSE_URLS = [FANDOM_LICENSING_URL, CC_BY_SA_3_URL];

function trustedLicenseUrl(license: string, licenseUrl: string): string | null {
  const allowed = ALLOWED_LICENSE_URLS.find((url) => url === licenseUrl);
  if (allowed) return allowed;
  return license === "CC BY-SA 3.0" ? FANDOM_LICENSING_URL : null;
}

function openExternal(url: string): void {
  void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url)).catch(() => {});
}

/** Presentational: shows the roster snapshot date, its licence and the update action. */
export function RosterOverlayPanel({ info, status, error, onUpdate }: RosterOverlayPanelProps) {
  const { t, i18n } = useTranslation();
  const updating = status === "updating";
  const checking = status === "checking";

  if (!info) return null;

  const asOf = formatDate(info.as_of, i18n.language);
  const { source } = info;
  const licenseHref = trustedLicenseUrl(source.license, source.license_url);

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-card/40 px-6 py-2 text-xs text-muted-foreground"
      data-testid="roster-overlay-panel"
    >
      <div className="min-w-0 flex-1">
        <p className="font-heading text-xs font-bold uppercase tracking-wider text-foreground">
          {t("rosterOverlay.asOf", "Rosters as of {{date}}", { date: asOf })}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/80">
          {t("rosterOverlay.attribution", "Roster data: {{name}} contributors,", {
            name: source.name,
          })}{" "}
          {licenseHref ? (
            <a
              href={licenseHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!("__TAURI_INTERNALS__" in window)) return;
                event.preventDefault();
                openExternal(licenseHref);
              }}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {source.license}
            </a>
          ) : (
            source.license
          )}
        </p>
      </div>

      <div className="flex items-center gap-3" aria-live="polite">
        {checking && (
          <span>{t("rosterOverlay.checking", "Checking for roster updates…")}</span>
        )}
        {status === "checkFailed" && (
          <span>
            {t(
              "rosterOverlay.checkFailed",
              "Couldn't check for roster updates. Using the rosters shown.",
            )}
          </span>
        )}
        {status === "updated" && (
          <span className="text-primary">
            {t("rosterOverlay.updated", "Rosters updated to {{date}}", { date: asOf })}
          </span>
        )}
        {status === "upToDate" && (
          <span>{t("rosterOverlay.upToDate", "Rosters already up to date")}</span>
        )}
        <Button type="button" variant="outline" size="sm" disabled={updating || checking} onClick={onUpdate}>
          {updating || checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {updating
            ? t("rosterOverlay.updating", "Updating...")
            : t("rosterOverlay.update", "Update rosters")}
        </Button>
      </div>

      {status === "error" && error && (
        <p role="alert" className="basis-full text-[11px] text-destructive">
          {t(
            "rosterOverlay.error",
            "Could not update rosters: {{message}}. You can still start with the current rosters.",
            { message: error },
          )}
        </p>
      )}
    </div>
  );
}
