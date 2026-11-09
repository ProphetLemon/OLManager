import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Trash2, Upload } from "lucide-react";

import { LOGO_ACCEPT_ATTRIBUTE, LogoUploadError, buildLogoFromFile, parseLogoError } from "@/lib/customTeam/logo";
import type { LogoErrorCode } from "@/lib/customTeam/logo";
import { Button } from "@/ui-v2/components/ui/button";

export interface LogoUploadControlProps {
  /** Normalized `data:image/png;base64,...` currently in use, or `null` for the generated badge. */
  value: string | null;
  onChange: (logoDataUri: string | null) => void;
  /** Raw backend rejection of the logo (from `select_team`), shown inline. */
  backendError?: string | null;
  /** Called when the user picks or removes an image so a stale backend error can be dismissed. */
  onInteract?: () => void;
  disabled?: boolean;
}

const ERROR_KEYS: Record<LogoErrorCode, string> = {
  unsupportedType: "teamSelect.customLogo.errors.unsupportedType",
  fileTooLarge: "teamSelect.customLogo.errors.fileTooLarge",
  unreadable: "teamSelect.customLogo.errors.unreadable",
  invalid: "teamSelect.customLogo.errors.invalid",
  tooBig: "teamSelect.customLogo.errors.tooBig",
  failed: "teamSelect.customLogo.errors.failed",
};

/**
 * Badge-step control to replace the generated shield with the user's own image.
 *
 * The picked file is re-encoded in the browser and normalized by the backend
 * (see `@/lib/customTeam/logo`); this component only reports the final string.
 * Errors are announced through a live region and the previous choice is kept.
 */
export default function LogoUploadControl({
  value,
  onChange,
  backendError,
  onInteract,
  disabled = false,
}: LogoUploadControlProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const latestRequest = useRef(0);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<LogoErrorCode | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const shownError: LogoErrorCode | null = errorCode ?? (backendError ? parseLogoError(backendError) : null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again after a removal still fires `change`.
    event.target.value = "";
    if (!file) return;
    onInteract?.();
    const request = ++latestRequest.current;
    setBusy(true);
    setErrorCode(null);
    try {
      const logo = await buildLogoFromFile(file);
      if (!mounted.current || request !== latestRequest.current) return;
      onChange(logo);
    } catch (error) {
      if (!mounted.current || request !== latestRequest.current) return;
      setErrorCode(error instanceof LogoUploadError ? error.code : "failed");
    } finally {
      if (mounted.current && request === latestRequest.current) setBusy(false);
    }
  };

  const handleRemove = () => {
    latestRequest.current += 1;
    setBusy(false);
    setErrorCode(null);
    onInteract?.();
    onChange(null);
    // The visible Upload button, not the hidden file input, so the focus ring stays on screen.
    uploadRef.current?.focus();
  };

  return (
    <fieldset aria-busy={busy} className="space-y-3">
      <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {t("teamSelect.customLogo.heading")}
      </legend>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
          {value ? (
            <img
              src={value}
              alt={t("teamSelect.customLogo.previewAlt")}
              width={64}
              height={64}
              className="size-16 object-contain"
              data-testid="logo-upload-preview"
            />
          ) : (
            <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id="custom-team-logo"
            type="file"
            accept={LOGO_ACCEPT_ATTRIBUTE}
            disabled={disabled || busy}
            onChange={(event) => void handleFile(event)}
            aria-hidden="true"
            className="sr-only"
            tabIndex={-1}
            data-testid="logo-file-input"
          />
          <Button
            ref={uploadRef}
            type="button"
            variant="outline"
            // While the file is prepared the button stays focusable (aria-disabled, not disabled):
            // disabling the focused element makes the browser drop focus to <body>.
            disabled={disabled}
            aria-disabled={busy || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!busy) inputRef.current?.click();
            }}
            aria-describedby="custom-team-logo-hint"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="size-4" aria-hidden="true" />
            )}
            {value ? t("teamSelect.customLogo.replace") : t("teamSelect.customLogo.upload")}
          </Button>
          {value && (
            <Button type="button" variant="ghost" onClick={handleRemove}>
              <Trash2 className="size-4" aria-hidden="true" />
              {t("teamSelect.customLogo.remove")}
            </Button>
          )}
        </div>
      </div>
      <p id="custom-team-logo-hint" className="text-xs text-muted-foreground">
        {t("teamSelect.customLogo.hint")}
      </p>
      <div aria-live="polite" className="min-h-0 text-xs">
        {busy && <p className="text-muted-foreground">{t("teamSelect.customLogo.processing")}</p>}
        {!busy && value && !shownError && (
          <p className="text-muted-foreground">{t("teamSelect.customLogo.inUse")}</p>
        )}
      </div>
      {shownError && (
        <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t(ERROR_KEYS[shownError])}
        </p>
      )}
    </fieldset>
  );
}
