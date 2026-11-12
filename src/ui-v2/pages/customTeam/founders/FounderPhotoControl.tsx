import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Camera, Loader2, Trash2 } from "lucide-react";

import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { LOGO_ACCEPT_ATTRIBUTE, LogoUploadError } from "@/lib/customTeam/logo";
import type { LogoErrorCode } from "@/lib/customTeam/logo";
import { buildPortraitFromFile } from "@/lib/customTeam/portrait";
import { Button } from "@/ui-v2/components/ui/button";

export interface FounderPhotoControlProps {
  playerId: string;
  nick: string;
  /** Role label, already translated, so the buttons say whose photo they change. */
  roleLabel: string;
  /** Normalized `data:image/png;base64,...` chosen for this founder, or `null` for the default avatar. */
  photo: string | null;
  onChange: (photo: string | null) => void;
  disabled?: boolean;
}

const ERROR_KEYS: Record<LogoErrorCode, string> = {
  unsupportedType: "teamSelect.founders.photo.errors.unsupportedType",
  fileTooLarge: "teamSelect.founders.photo.errors.fileTooLarge",
  unreadable: "teamSelect.founders.photo.errors.unreadable",
  invalid: "teamSelect.founders.photo.errors.invalid",
  tooBig: "teamSelect.founders.photo.errors.tooBig",
  failed: "teamSelect.founders.photo.errors.failed",
};

/**
 * Photo of one new player: the avatar the game will show, a button to choose or
 * replace the image and one to go back to the default avatar. The picked file is
 * prepared like the club badge (browser re-encode, then the backend's
 * validation); this component only reports the final string. Errors are
 * announced through a live region and the previous choice is kept.
 */
export default function FounderPhotoControl({
  playerId,
  nick,
  roleLabel,
  photo,
  onChange,
  disabled = false,
}: FounderPhotoControlProps) {
  const { t } = useTranslation();
  const hintId = useId();
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

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again after a removal still fires `change`.
    event.target.value = "";
    if (!file) return;
    const request = ++latestRequest.current;
    setBusy(true);
    setErrorCode(null);
    try {
      const prepared = await buildPortraitFromFile(file);
      if (!mounted.current || request !== latestRequest.current) return;
      onChange(prepared);
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
    onChange(null);
    // The visible choose button, not the hidden file input, so the focus ring stays on screen.
    uploadRef.current?.focus();
  };

  const names = { nick, role: roleLabel };
  const avatar = resolvePlayerPhoto(playerId, nick, photo);

  return (
    <div className="flex flex-col gap-1.5" aria-busy={busy}>
      <div className="flex items-center gap-3">
        <div className="size-14 shrink-0 overflow-hidden rounded-full border border-border bg-muted/30">
          {avatar && (
            <img
              src={avatar}
              alt={t("teamSelect.founders.photo.previewAlt", names)}
              width={56}
              height={56}
              className="size-14 object-cover"
              data-testid={`founder-photo-preview-${playerId}`}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_ACCEPT_ATTRIBUTE}
            disabled={disabled || busy}
            onChange={(event) => void handleFile(event)}
            aria-hidden="true"
            className="sr-only"
            tabIndex={-1}
            data-testid={`founder-photo-input-${playerId}`}
          />
          <Button
            ref={uploadRef}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            // While the file is prepared the button stays focusable (aria-disabled, not disabled).
            aria-disabled={busy || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!busy) inputRef.current?.click();
            }}
            aria-describedby={hintId}
            aria-label={t(photo ? "teamSelect.founders.photo.replaceAria" : "teamSelect.founders.photo.addAria", names)}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Camera aria-hidden="true" />
            )}
            {photo ? t("teamSelect.founders.photo.replace") : t("teamSelect.founders.photo.add")}
          </Button>
          {photo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleRemove}
              aria-label={t("teamSelect.founders.photo.removeAria", names)}
            >
              <Trash2 aria-hidden="true" />
              {t("teamSelect.founders.photo.remove")}
            </Button>
          )}
        </div>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t("teamSelect.founders.photo.hint")}
      </p>
      <div aria-live="polite" className="min-h-0 text-xs">
        {busy && <p className="text-muted-foreground">{t("teamSelect.founders.photo.processing")}</p>}
      </div>
      {errorCode && (
        <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t(ERROR_KEYS[errorCode], names)}
        </p>
      )}
    </div>
  );
}
