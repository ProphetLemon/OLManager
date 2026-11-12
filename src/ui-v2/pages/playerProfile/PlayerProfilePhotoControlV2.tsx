import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Camera, Loader2, Trash2 } from "lucide-react";

import { parseFounderError, setPlayerPhoto } from "@/lib/customTeam/founders";
import { LOGO_ACCEPT_ATTRIBUTE, LogoUploadError, parseLogoError } from "@/lib/customTeam/logo";
import type { LogoErrorCode } from "@/lib/customTeam/logo";
import { buildPortraitFromFile } from "@/lib/customTeam/portrait";
import type { GameStateData } from "@/store/gameStore";
import { Button } from "@/ui-v2/components/ui/button";

interface PlayerProfilePhotoControlV2Props {
  player: { id: string; match_name: string; profile_image_url?: string | null };
  /** Called with the game the backend returns once the photo is saved. */
  onChanged: (game: GameStateData) => void;
}

/** Same messages as the club wizard's photo control, so a refused file reads the same. */
const FILE_ERROR_KEYS: Record<LogoErrorCode, string> = {
  unsupportedType: "teamSelect.founders.photo.errors.unsupportedType",
  fileTooLarge: "teamSelect.founders.photo.errors.fileTooLarge",
  unreadable: "teamSelect.founders.photo.errors.unreadable",
  invalid: "teamSelect.founders.photo.errors.invalid",
  tooBig: "teamSelect.founders.photo.errors.tooBig",
  failed: "teamSelect.founders.photo.errors.failed",
};

type PhotoError = { kind: "file"; code: LogoErrorCode } | { kind: "notAFounder" } | { kind: "saveFailed" };

/**
 * Change or remove the photo of one of the manager's own founders from the
 * profile. The picked file takes the wizard's path (browser re-encode, then the
 * backend's validation); the command then stores it and answers with the game,
 * so every avatar of the player updates through the same game update as a
 * rename. A refused file is announced and the current photo stays.
 */
export default function PlayerProfilePhotoControlV2({ player, onChanged }: PlayerProfilePhotoControlV2Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PhotoError | null>(null);
  const hasPhoto = Boolean(player.profile_image_url?.trim());
  const names = { nick: player.match_name };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = async (photoPromise: Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const photo = await photoPromise;
      const game = await setPlayerPhoto<GameStateData>(player.id, photo);
      if (mounted.current) onChanged(game);
    } catch (caught) {
      if (!mounted.current) return;
      if (caught instanceof LogoUploadError) {
        setError({ kind: "file", code: caught.code });
        return;
      }
      const raw = String(caught);
      const founderError = parseFounderError(raw);
      if (founderError?.kind === "not_a_founder") setError({ kind: "notAFounder" });
      else if (founderError?.kind === "invalid_photo") setError({ kind: "file", code: parseLogoError(raw) });
      else setError({ kind: "saveFailed" });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again after a refusal still fires `change`.
    event.target.value = "";
    if (!file || busy) return;
    void save(buildPortraitFromFile(file));
  };

  let message: string | null = null;
  if (error?.kind === "file") message = t(FILE_ERROR_KEYS[error.code], names);
  else if (error?.kind === "notAFounder") message = t("playerProfile.photo.notAFounder");
  else if (error?.kind === "saveFailed") message = t("playerProfile.photo.saveFailed");

  return (
    <div className="flex w-full max-w-40 flex-col items-stretch gap-1.5" aria-busy={busy}>
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT_ATTRIBUTE}
        disabled={busy}
        onChange={handleFile}
        aria-hidden="true"
        className="sr-only"
        tabIndex={-1}
        data-testid="player-photo-input"
      />
      <Button
        ref={pickRef}
        type="button"
        variant="outline"
        size="touch"
        aria-disabled={busy || undefined}
        aria-label={t(hasPhoto ? "playerProfile.photo.changeAria" : "playerProfile.photo.addAria", names)}
        className="w-full text-club-text aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}
        {t(hasPhoto ? "playerProfile.photo.change" : "playerProfile.photo.add")}
      </Button>
      {hasPhoto && (
        <Button
          type="button"
          variant="ghost"
          size="touch"
          disabled={busy}
          aria-label={t("playerProfile.photo.removeAria", names)}
          className="w-full"
          onClick={() => {
            void save(Promise.resolve(null));
            pickRef.current?.focus();
          }}
        >
          <Trash2 aria-hidden="true" />
          {t("playerProfile.photo.remove")}
        </Button>
      )}
      <div aria-live="polite" className="text-xs text-muted-foreground">
        {busy && t("playerProfile.photo.processing")}
      </div>
      {message && (
        <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}
    </div>
  );
}
