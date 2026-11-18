import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { formatDate } from "@/lib/formatting/dateFormatting";
import type { WorldOverlayInfo } from "@/services/worldOverlayService";
import type { RosterUpdateStatus } from "@/store/rosterUpdateStore";
import { Button } from "@/ui-v2/components/ui/button";

interface RosterOverlayPanelProps {
  /** The overlay a new game would use; null until it is known. */
  info: WorldOverlayInfo | null;
  status: RosterUpdateStatus;
  /** Retry after a failed check (the manual path). */
  onRetry: () => void;
  /** Extra controls hosted at the end of the panel (e.g. the bug report button). */
  actions?: ReactNode;
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

/**
 * Presentational: the roster date a new game will use, the state of the
 * automatic update check, and the licence. Checks run on their own; the only
 * action is Retry, shown after a failed check.
 *
 * The status line is one polite live region rendered from the first paint and
 * only its text changes, so arriving at the screen announces nothing and every
 * later change of the check is announced.
 */
export function RosterOverlayPanel({ info, status, onRetry, actions }: RosterOverlayPanelProps) {
  const { t, i18n } = useTranslation();
  const statusLineRef = useRef<HTMLParagraphElement>(null);
  const failureId = useId();

  const date = info ? formatDate(info.as_of, i18n.language) : null;
  const dateText =
    date === null
      ? null
      : status === "updated"
        ? t("rosterOverlay.updated", { date })
        : t("rosterOverlay.asOf", { date });
  const licenseHref = info ? trustedLicenseUrl(info.source.license, info.source.license_url) : null;

  const retry = () => {
    onRetry();
    // Retry disappears while the check runs; keep focus on what it changed.
    statusLineRef.current?.focus();
  };

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-card/40 px-6 py-2 text-xs text-muted-foreground"
      data-testid="roster-overlay-panel"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <p
            ref={statusLineRef}
            tabIndex={-1}
            aria-live="polite"
            aria-atomic="true"
            data-testid="roster-status"
            className="rounded-sm font-heading text-xs font-bold uppercase tracking-wide text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {dateText}
            {dateText !== null && (status === "checking" || status === "failed") && (
              <span aria-hidden="true"> · </span>
            )}
            {status === "checking" && (
              <span className="font-normal text-muted-foreground">
                {t("rosterOverlay.checking")}
              </span>
            )}
            {status === "failed" && (
              <span id={failureId} className="text-foreground">
                {t("rosterOverlay.checkFailed")}
              </span>
            )}
          </p>
          {status === "failed" && (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="min-h-[var(--hit)] px-1 text-caption underline underline-offset-2"
              aria-describedby={failureId}
              onClick={retry}
            >
              {t("common.retry")}
            </Button>
          )}
        </div>
        {info && (
          <p className="mt-0.5 text-caption text-muted-foreground/80">
            {t("rosterOverlay.attribution", { name: info.source.name })}{" "}
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
                {info.source.license}
              </a>
            ) : (
              info.source.license
            )}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-3" data-testid="roster-overlay-actions">
          {actions}
        </div>
      )}
    </div>
  );
}
