import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";

import { countryName } from "@/lib/common/countries";
import { diffOverride, limitsFor, reasonKey, withRoleOverride } from "@/lib/customTeam/founders";
import type {
  FounderError,
  FounderField,
  FounderOverrides,
  FounderSummary,
} from "@/lib/customTeam/founders";
import { Button } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "@/ui-v2/pages/playerProfile/modalFieldStyles";

export interface FounderEditDialogProps {
  /** The founder as shown now (generated identity plus any earlier edit). */
  founder: FounderSummary;
  /** The generated founder: edits are diffed against it. */
  generated: FounderSummary;
  overrides: FounderOverrides;
  allowedNationalities: readonly string[];
  /** Previews the candidate overrides; resolves with the backend's field error or null. */
  onApply: (next: FounderOverrides) => Promise<FounderError | null>;
  onClose: () => void;
}

type Draft = Record<FounderField, string>;

export default function FounderEditDialog({
  founder,
  generated,
  overrides,
  allowedNationalities,
  onApply,
  onClose,
}: FounderEditDialogProps) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const [draft, setDraft] = useState<Draft>({
    nick: founder.nick,
    full_name: founder.full_name,
    nationality: founder.nationality,
    birth_date: founder.date_of_birth,
  });
  const [fieldError, setFieldError] = useState<{ field: FounderField; message: string } | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const roleName = t(`onAir.roles.${founder.role}`);
  const generatedMatches = diffOverride(generated, draft) === null;
  const nationalityOptions = Array.from(
    new Set([...allowedNationalities, founder.nationality]),
  ).map((code) => ({ code, name: countryName(code, i18n.language) || code }));
  nationalityOptions.sort((a, b) => a.name.localeCompare(b.name, i18n.language));

  const set = (field: FounderField, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    if (fieldError?.field === field) setFieldError(null);
    setGeneralError(null);
  };

  const fieldLabel = (field: FounderField) => t(`teamSelect.founders.dialog.fields.${field}`);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    const next = withRoleOverride(overrides, founder.role, diffOverride(generated, draft));
    if (JSON.stringify(next) === JSON.stringify(overrides)) {
      onClose();
      return;
    }
    setSaving(true);
    setFieldError(null);
    setGeneralError(null);
    try {
      const error = await onApply(next);
      if (!error) {
        onClose();
        return;
      }
      if (error.kind === "invalid_field" && error.role === founder.role) {
        setFieldError({
          field: error.field,
          message: t(`teamSelect.founders.errors.${reasonKey(error.reason)}`, limitsFor(error.field)),
        });
      } else {
        setGeneralError(t("teamSelect.founders.errors.general"));
      }
    } catch {
      setGeneralError(t("teamSelect.founders.errors.general"));
    } finally {
      setSaving(false);
    }
  };

  // The wizard behind the dialog closes a step on Escape; the dialog takes it first.
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (!saving) onClose();
  };

  const idFor = (field: FounderField) => `${baseId}-${field}`;
  const errorFor = (field: FounderField) => (fieldError?.field === field ? fieldError.message : null);
  const describedBy = (field: FounderField) =>
    [field === "birth_date" ? `${idFor(field)}-hint` : null, errorFor(field) ? `${idFor(field)}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const inputProps = (field: FounderField) => ({
    id: idFor(field),
    value: draft[field],
    disabled: saving,
    "aria-invalid": errorFor(field) ? true : undefined,
    "aria-describedby": describedBy(field),
    className: FIELD_CLASS + " aria-[invalid=true]:border-destructive",
  });

  return (
    <Dialog open onOpenChange={(open) => (open || saving ? undefined : onClose())}>
      <DialogContent onKeyDown={handleKeyDown} className="space-y-4">
        <DialogTitle>{t("teamSelect.founders.dialog.title", { role: roleName })}</DialogTitle>
        <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <div>
            <label htmlFor={idFor("nick")} className={FIELD_LABEL_CLASS}>
              {fieldLabel("nick")}
            </label>
            <input
              {...inputProps("nick")}
              type="text"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => set("nick", event.target.value)}
            />
            <FieldError id={`${idFor("nick")}-error`} message={errorFor("nick")} />
          </div>

          <div>
            <label htmlFor={idFor("full_name")} className={FIELD_LABEL_CLASS}>
              {fieldLabel("full_name")}
            </label>
            <input
              {...inputProps("full_name")}
              type="text"
              autoComplete="off"
              onChange={(event) => set("full_name", event.target.value)}
            />
            <FieldError id={`${idFor("full_name")}-error`} message={errorFor("full_name")} />
          </div>

          <div>
            <label htmlFor={idFor("nationality")} className={FIELD_LABEL_CLASS}>
              {fieldLabel("nationality")}
            </label>
            <select {...inputProps("nationality")} onChange={(event) => set("nationality", event.target.value)}>
              {nationalityOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
            <FieldError id={`${idFor("nationality")}-error`} message={errorFor("nationality")} />
          </div>

          <div>
            <label htmlFor={idFor("birth_date")} className={FIELD_LABEL_CLASS}>
              {fieldLabel("birth_date")}
            </label>
            <input
              {...inputProps("birth_date")}
              type="date"
              min={founder.birth_date_min}
              max={founder.birth_date_max}
              onChange={(event) => set("birth_date", event.target.value)}
            />
            <p id={`${idFor("birth_date")}-hint`} className="mt-1 text-xs text-muted-foreground">
              {t("teamSelect.founders.dialog.birthHint", {
                age: founder.age,
                min: founder.birth_date_min,
                max: founder.birth_date_max,
              })}
            </p>
            <FieldError id={`${idFor("birth_date")}-error`} message={errorFor("birth_date")} />
          </div>

          {generalError && (
            <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              {generalError}
            </p>
          )}

          <DialogFooter className="items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={saving || generatedMatches}
              onClick={() =>
                setDraft({
                  nick: generated.nick,
                  full_name: generated.full_name,
                  nationality: generated.nationality,
                  birth_date: generated.date_of_birth,
                })
              }
            >
              {t("teamSelect.founders.dialog.restore")}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
                {t("teamSelect.founders.dialog.cancel")}
              </Button>
              <Button type="submit" variant="club" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {t("teamSelect.founders.dialog.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 flex items-center gap-1.5 text-xs font-medium text-destructive">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
