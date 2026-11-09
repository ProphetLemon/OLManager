import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";

import { FIELD_LIMITS, parseFounderError, reasonKey, renamePlayer } from "@/lib/customTeam/founders";
import type { FounderError } from "@/lib/customTeam/founders";
import type { GameStateData } from "@/store/gameStore";
import { Button } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "@/ui-v2/pages/playerProfile/modalFieldStyles";

type RenameField = "nick" | "full_name";

interface PlayerProfileRenameModalV2Props {
  player: { id: string; match_name: string; full_name: string };
  onClose: () => void;
  /** Called with the game the backend returns once the rename is saved. */
  onRenamed: (game: GameStateData) => void;
}

export default function PlayerProfileRenameModalV2({
  player,
  onClose,
  onRenamed,
}: PlayerProfileRenameModalV2Props) {
  const { t } = useTranslation();
  const baseId = useId();
  const [nick, setNick] = useState(player.match_name);
  const [fullName, setFullName] = useState(player.full_name);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: RenameField; message: string } | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const message = (error: FounderError): { field?: RenameField; text: string } => {
    switch (error.kind) {
      case "invalid_field": {
        const field = error.field === "nick" || error.field === "full_name" ? error.field : undefined;
        const key = reasonKey(error.reason);
        const known = ["empty", "tooShort", "tooLong", "invalidCharacter", "taken"].includes(key);
        if (!field || !known) return { text: t("playerProfile.rename.errors.general") };
        return { field, text: t(`playerProfile.rename.errors.${key}`, FIELD_LIMITS[field]) };
      }
      case "nothing_to_change":
        return { text: t("playerProfile.rename.errors.nothingToChange") };
      case "not_a_founder":
        return { text: t("playerProfile.rename.errors.notAFounder") };
      default:
        return { text: t("playerProfile.rename.errors.general") };
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    const changes: { nick?: string; fullName?: string } = {};
    if (nick.trim() !== player.match_name) changes.nick = nick.trim();
    if (fullName.trim() !== player.full_name) changes.fullName = fullName.trim();

    setFieldError(null);
    setGeneralError(null);
    if (changes.nick === undefined && changes.fullName === undefined) {
      setGeneralError(t("playerProfile.rename.errors.nothingToChange"));
      return;
    }

    setSaving(true);
    try {
      const game = await renamePlayer<GameStateData>(player.id, changes);
      onRenamed(game);
    } catch (caught) {
      const parsed = parseFounderError(String(caught));
      const shown = parsed ? message(parsed) : { text: t("playerProfile.rename.errors.general") };
      if (shown.field) setFieldError({ field: shown.field, message: shown.text });
      else setGeneralError(shown.text);
      setSaving(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (!saving) onClose();
  };

  const nickId = `${baseId}-nick`;
  const fullNameId = `${baseId}-full-name`;
  const nickError = fieldError?.field === "nick" ? fieldError.message : null;
  const fullNameError = fieldError?.field === "full_name" ? fieldError.message : null;
  const fieldClass = FIELD_CLASS + " aria-[invalid=true]:border-destructive";

  return (
    <Dialog open onOpenChange={(open) => (open || saving ? undefined : onClose())}>
      <DialogContent onKeyDown={handleKeyDown} className="space-y-4">
        <DialogTitle>{t("playerProfile.rename.title")}</DialogTitle>
        <p className="text-sm text-muted-foreground">{t("playerProfile.rename.hint")}</p>
        <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <div>
            <label htmlFor={nickId} className={FIELD_LABEL_CLASS}>
              {t("playerProfile.rename.nick")}
            </label>
            <input
              id={nickId}
              type="text"
              value={nick}
              disabled={saving}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nickError ? true : undefined}
              aria-describedby={nickError ? `${nickId}-error` : undefined}
              onChange={(event) => {
                setNick(event.target.value);
                if (nickError) setFieldError(null);
                setGeneralError(null);
              }}
              className={fieldClass}
            />
            {nickError && <FieldError id={`${nickId}-error`} message={nickError} />}
          </div>
          <div>
            <label htmlFor={fullNameId} className={FIELD_LABEL_CLASS}>
              {t("playerProfile.rename.fullName")}
            </label>
            <input
              id={fullNameId}
              type="text"
              value={fullName}
              disabled={saving}
              autoComplete="off"
              aria-invalid={fullNameError ? true : undefined}
              aria-describedby={fullNameError ? `${fullNameId}-error` : undefined}
              onChange={(event) => {
                setFullName(event.target.value);
                if (fullNameError) setFieldError(null);
                setGeneralError(null);
              }}
              className={fieldClass}
            />
            {fullNameError && <FieldError id={`${fullNameId}-error`} message={fullNameError} />}
          </div>
          {generalError && <FieldError message={generalError} />}
          <DialogFooter className="justify-end">
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              {t("playerProfile.rename.cancel")}
            </Button>
            <Button type="submit" variant="club" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("playerProfile.rename.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ id, message }: { id?: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1 flex items-center gap-1.5 text-xs font-medium text-destructive">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
