import { useEffect, useId, useRef, useState } from "react";
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
 * What to announce when a check ends with `status`, or "" for nothing. The
 * announced sentences carry the date so they stand on their own.
 */
function outcomeSentence(
  status: RosterUpdateStatus,
  date: string | null,
  t: (key: string, options?: Record<string, string>) => string,
): string {
  if (status === "failed") return t("rosterOverlay.checkFailed");
  if (date === null) return "";
  if (status === "updated") return t("rosterOverlay.updated", { date });
  if (status === "upToDate") return t("rosterOverlay.upToDate", { date });
  return "";
}

/**
 * Presentational: the roster date a new game will use, the state of the
 * automatic update check, and the licence. Checks run on their own; the only
 * action is Retry, shown after a failed check.
 *
 * Retry never takes focus away. It stays in place, marked unavailable, while
 * the check it follows runs, and after a success it only goes once focus has
 * left it, so a keyboard user is never dropped.
 *
 * Retry sits in the panel row beside the text, not under the status line: its
 * whole --hit box is its own (no other target, such as the licence link, lies
 * inside it), and since the text column already reserves the --hit height,
 * showing it never changes the footer's height.
 *
 * The visible line is not announced. A visually hidden status region, present
 * from the first paint, speaks only the outcome of a check that was running
 * while the screen was open: arriving at the screen, a check starting and a
 * date that loads late all stay silent.
 */
export function RosterOverlayPanel({ info, status, onRetry, actions }: RosterOverlayPanelProps) {
  const { t, i18n } = useTranslation();
  const detailId = useId();

  const date = info ? formatDate(info.as_of, i18n.language) : null;
  const dateText =
    date === null
      ? null
      : status === "updated"
        ? t("rosterOverlay.updated", { date })
        : t("rosterOverlay.asOf", { date });

  // The sentence is taken when the status changes and kept until the next
  // change, so a later date or language change never announces again. It is
  // cleared while a check runs, so the same outcome twice is spoken twice.
  const outcome = outcomeSentence(status, date, t);
  const [announcement, setAnnouncement] = useState("");
  const announcedStatus = useRef(status);
  useEffect(() => {
    const previous = announcedStatus.current;
    if (previous === status) return;
    announcedStatus.current = status;
    if (status === "checking") setAnnouncement("");
    else if (previous === "checking") setAnnouncement(outcome);
  }, [status, outcome]);
  const licenseHref = info ? trustedLicenseUrl(info.source.license, info.source.license_url) : null;

  // Whether Retry belongs on screen: after a failure, and through the check
  // that follows it. Adjusted during render, not in an effect, so Retry is
  // never unmounted for a frame while it may hold focus.
  const [retryTrack, setRetryTrack] = useState({ status, afterFailure: status === "failed" });
  if (retryTrack.status !== status) {
    const afterFailure = status === "failed" || (status === "checking" && retryTrack.afterFailure);
    setRetryTrack({ status, afterFailure });
  }
  const [retryFocused, setRetryFocused] = useState(false);
  const showRetry = retryTrack.afterFailure || retryFocused;
  const hasDetail = status === "checking" || status === "failed";

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-card/40 px-6 py-2 text-xs text-muted-foreground"
      data-testid="roster-overlay-panel"
    >
      <div className="flex min-h-[var(--hit)] min-w-0 flex-1 flex-col justify-center">
        <p
          data-testid="roster-status"
          className="font-heading text-xs font-bold uppercase tracking-wide text-foreground"
        >
          {dateText}
          {dateText !== null && hasDetail && <span aria-hidden="true"> · </span>}
          {status === "checking" && (
            <span id={detailId} className="font-normal text-muted-foreground">
              {t("rosterOverlay.checking")}
            </span>
          )}
          {status === "failed" && (
            <span id={detailId} className="text-foreground">
              {t("rosterOverlay.checkFailed")}
            </span>
          )}
        </p>
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {info && (
          <p className="mt-0.5 text-caption text-dim">
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

      {showRetry && (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="min-h-[var(--hit)] min-w-[var(--hit)] px-1 text-caption underline underline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          disabled={status !== "failed"}
          focusableWhenDisabled
          aria-describedby={hasDetail ? detailId : undefined}
          onFocus={() => setRetryFocused(true)}
          onBlur={() => setRetryFocused(false)}
          onClick={onRetry}
        >
          {t("common.retry")}
        </Button>
      )}

      {actions && (
        <div className="flex items-center gap-3" data-testid="roster-overlay-actions">
          {actions}
        </div>
      )}
    </div>
  );
}
