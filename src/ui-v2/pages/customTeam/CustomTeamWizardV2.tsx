import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";

import {
  LOW_CONTRAST_RATIO,
  NAME_MAX,
  NAME_MIN,
  SHORT_NAME_MAX,
  SHORT_NAME_MIN,
  buildBadgeDataUri,
  contrastRatio,
  defaultReplacementId,
  mapBackendCustomTeamError,
  normalizeColor,
  normalizeShortName,
  validateCustomTeam,
} from "@/lib/customTeam";
import type { CustomTeamField, ValidationCode } from "@/lib/customTeam";
import { allNationalities } from "@/lib/common/countries";
import type { CompetitionSummary, CustomTeamSpec, TeamSummary } from "@/store/types";
import { Card, CardContent, CardHeader } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";
import {
  getReputationLabel,
  getTeamLogoPath,
} from "@/ui-v2/_legacy/components/teamSelection/teamSelection.helpers";

export interface CustomTeamWizardV2Props {
  competition: CompetitionSummary;
  onCancel: () => void;
  onConfirm: (spec: CustomTeamSpec, replacesTeamId: string) => void;
  isSubmitting: boolean;
  /** Raw backend rejection, shown inside the wizard instead of navigating away. */
  error: string | null;
}

type Step = 0 | 1 | 2;
const LAST_STEP: Step = 2;

/** Colour pairs offered as one-click badge presets: [primary, secondary]. */
export const BADGE_PRESETS: ReadonlyArray<readonly [string, string]> = [
  ["#f97316", "#18181b"],
  ["#1d4ed8", "#ffffff"],
  ["#b91c1c", "#fafafa"],
  ["#047857", "#ffffff"],
  ["#6d28d9", "#fde047"],
  ["#18181b", "#facc15"],
  ["#f4f4f5", "#1e3a8a"],
  ["#0f766e", "#fdba74"],
];

const FIELD_STEP: Record<CustomTeamField, Step> = {
  name: 0,
  shortName: 0,
  country: 0,
  primary: 1,
  secondary: 1,
  replaces: 2,
};

const HEX = /^#[0-9a-f]{6}$/i;

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-[invalid=true]:border-destructive";

/** Short name suggestion: initials for 3+ words, otherwise the first three letters. */
export function suggestShortName(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  const base =
    words.length >= 3 ? words.map((word) => word[0]).join("") : (words[0] ?? "").slice(0, SHORT_NAME_MIN);
  return base.toUpperCase().slice(0, SHORT_NAME_MAX);
}

/** Country code most clubs of the league share, when it is a selectable nationality. */
function leagueCountry(teams: TeamSummary[], options: { code: string; name: string }[]): string {
  const counts = new Map<string, number>();
  for (const team of teams) {
    const raw = team.country?.trim().toLowerCase();
    const match = options.find(
      (option) => option.code.toLowerCase() === raw || option.name.toLowerCase() === raw,
    );
    if (match) counts.set(match.code, (counts.get(match.code) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground/80">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export default function CustomTeamWizardV2({
  competition,
  onCancel,
  onConfirm,
  isSubmitting,
  error,
}: CustomTeamWizardV2Props) {
  const { t, i18n } = useTranslation();
  const nationalities = useMemo(() => allNationalities(i18n.language), [i18n.language]);
  const teams = competition.teams;

  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [shortEdited, setShortEdited] = useState(false);
  const [country, setCountry] = useState(() => leagueCountry(teams, nationalities));
  const [primary, setPrimary] = useState(BADGE_PRESETS[0][0]);
  const [secondary, setSecondary] = useState(BADGE_PRESETS[0][1]);
  const [replacesId, setReplacesId] = useState<string | null>(() => defaultReplacementId(teams));
  const [touched, setTouched] = useState<ReadonlySet<CustomTeamField>>(new Set());
  const [ackedError, setAckedError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const draft = { name, shortName, primary, secondary, country, replacesTeamId: replacesId };
  const validation = validateCustomTeam(draft, teams);
  const stepFields = (Object.keys(FIELD_STEP) as CustomTeamField[]).filter((f) => FIELD_STEP[f] === step);
  const stepValid = stepFields.every((field) => !validation.errors[field]);

  // Move focus to the step heading whenever the step changes so keyboard and
  // screen reader users land on the new content.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const backend = error && error !== ackedError ? mapBackendCustomTeamError(error) : null;
  useEffect(() => {
    if (backend) setStep(FIELD_STEP[backend.field]);
  }, [backend?.field, backend?.code, error]); // eslint-disable-line react-hooks/exhaustive-deps

  // A fresh submission clears the error; forget the acknowledgement so an
  // identical rejection is shown again.
  useEffect(() => {
    if (!error) setAckedError(null);
  }, [error]);

  const touch = (field: CustomTeamField) =>
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  const ackBackend = () => setAckedError(error);

  const message = (field: CustomTeamField, code: ValidationCode): string => {
    switch (`${field}:${code}`) {
      case "name:duplicate":
        return t("teamSelect.custom.errors.duplicateName");
      case "shortName:duplicate":
        return t("teamSelect.custom.errors.duplicateShortName");
      case "name:format":
        return t("teamSelect.custom.errors.nameFormat", {
          min: NAME_MIN,
          max: NAME_MAX,
        });
      case "shortName:format":
        return t("teamSelect.custom.errors.shortNameFormat");
      case "primary:format":
      case "secondary:format":
        return t("teamSelect.custom.errors.colorFormat");
      case "replaces:format":
        return t("teamSelect.custom.errors.replaceInvalid");
      case "replaces:required":
        return t("teamSelect.custom.errors.replaceRequired");
      default:
        break;
    }
    if (code === "tooShort") {
      return t("teamSelect.custom.errors.tooShort", {
        min: field === "name" ? NAME_MIN : SHORT_NAME_MIN,
      });
    }
    if (code === "tooLong") {
      return t("teamSelect.custom.errors.tooLong", {
        max: field === "name" ? NAME_MAX : SHORT_NAME_MAX,
      });
    }
    return t("teamSelect.custom.errors.required");
  };

  /** Inline error for a field: a backend rejection wins, local errors show once touched. */
  const errorFor = (field: CustomTeamField): string | undefined => {
    if (backend?.field === field) return message(field, backend.code);
    const code = validation.errors[field];
    return code && touched.has(field) ? message(field, code) : undefined;
  };

  const describedBy = (id: string, field: CustomTeamField, hasHint: boolean) =>
    [hasHint ? `${id}-hint` : null, errorFor(field) ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  const goBack = () => {
    if (step === 0) onCancel();
    else setStep((step - 1) as Step);
  };

  const goNext = () => {
    if (step < LAST_STEP && stepValid) setStep((step + 1) as Step);
    else stepFields.forEach(touch);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // Handled here so the screen-level Escape (back to the league) does not also fire.
    event.preventDefault();
    event.stopPropagation();
    goBack();
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!shortEdited) setShortName(suggestShortName(value));
    if (backend?.field === "name" || backend?.field === "shortName") ackBackend();
  };

  const handleConfirm = () => {
    if (!validation.ok || isSubmitting || !replacesId) return;
    onConfirm(
      {
        name: name.trim(),
        short_name: normalizeShortName(shortName),
        primary_color: normalizeColor(primary),
        secondary_color: normalizeColor(secondary),
        country,
      },
      replacesId,
    );
  };

  const badgeTag = normalizeShortName(shortName).replace(/[^A-Z0-9]/g, "").slice(0, SHORT_NAME_MAX) || "TAG";
  const badgePrimary = HEX.test(primary.trim()) ? normalizeColor(primary) : BADGE_PRESETS[0][0];
  const badgeSecondary = HEX.test(secondary.trim()) ? normalizeColor(secondary) : BADGE_PRESETS[0][1];
  const badgeSrc = buildBadgeDataUri(badgeTag, badgePrimary, badgeSecondary);
  const lowContrast = contrastRatio(badgePrimary, badgeSecondary) < LOW_CONTRAST_RATIO;
  const replaced = teams.find((team) => team.id === replacesId);
  const countryLabel = nationalities.find((option) => option.code === country)?.name ?? country;

  const stepTitles = [
    t("teamSelect.custom.steps.identity"),
    t("teamSelect.custom.steps.badge"),
    t("teamSelect.custom.steps.replace"),
  ];

  const colorField = (
    id: string,
    field: "primary" | "secondary",
    label: string,
    pickLabel: string,
    value: string,
    set: (value: string) => void,
  ) => (
    <Field id={id} label={label} error={errorFor(field)}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={pickLabel}
          value={HEX.test(value.trim()) ? value.trim().toLowerCase() : "#000000"}
          onChange={(event) => set(event.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <input
          id={id}
          type="text"
          value={value}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={errorFor(field) ? true : undefined}
          aria-describedby={describedBy(id, field, false)}
          onChange={(event) => set(event.target.value)}
          onBlur={() => touch(field)}
          className={cn(inputClass, "font-mono uppercase")}
        />
      </div>
    </Field>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 scrollbar-v2" onKeyDown={handleKeyDown}>
      <Card className="mx-auto max-w-3xl">
        <CardHeader className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="font-heading text-2xl font-black uppercase tracking-widest text-foreground"
              >
                {stepTitles[step]}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("teamSelect.custom.stepOf", {
                  current: step + 1,
                  total: LAST_STEP + 1,
                })}
                {" · "}
                {competition.name}
              </p>
            </div>
            <img
              src={badgeSrc}
              alt={t("teamSelect.custom.previewAlt", { tag: badgeTag })}
              width={96}
              height={96}
              className="size-24 shrink-0"
              data-testid="badge-preview-large"
            />
          </div>
          <ol aria-label={t("teamSelect.custom.stepsLabel")} className="flex gap-2">
            {stepTitles.map((title, index) => (
              <li
                key={title}
                aria-current={index === step ? "step" : undefined}
                className={cn(
                  "flex flex-1 items-center gap-2 border-b-2 pb-2 text-xs font-bold uppercase tracking-wider",
                  index === step ? "border-primary text-foreground" : "border-border text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-2xs tabular-nums",
                    index < step ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {index < step ? <Check className="size-3" aria-hidden="true" /> : index + 1}
                </span>
                <span className="hidden truncate sm:inline">{title}</span>
              </li>
            ))}
          </ol>
        </CardHeader>

        <CardContent className="space-y-6">
          {step === 0 && (
            <div className="space-y-5">
              <Field
                id="custom-team-name"
                label={t("teamSelect.custom.fields.name")}
                hint={t("teamSelect.custom.hints.name", {
                  min: NAME_MIN,
                  max: NAME_MAX,
                })}
                error={errorFor("name")}
              >
                <input
                  id="custom-team-name"
                  type="text"
                  value={name}
                  autoComplete="off"
                  aria-invalid={errorFor("name") ? true : undefined}
                  aria-describedby={describedBy("custom-team-name", "name", true)}
                  onChange={(event) => handleNameChange(event.target.value)}
                  onBlur={() => touch("name")}
                  className={inputClass}
                />
              </Field>
              <Field
                id="custom-team-short"
                label={t("teamSelect.custom.fields.shortName")}
                hint={t("teamSelect.custom.hints.shortName")}
                error={errorFor("shortName")}
              >
                <input
                  id="custom-team-short"
                  type="text"
                  value={shortName}
                  maxLength={SHORT_NAME_MAX}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={errorFor("shortName") ? true : undefined}
                  aria-describedby={describedBy("custom-team-short", "shortName", true)}
                  onChange={(event) => {
                    setShortEdited(true);
                    setShortName(event.target.value.toUpperCase());
                    if (backend?.field === "shortName") ackBackend();
                  }}
                  onBlur={() => touch("shortName")}
                  className={cn(inputClass, "font-heading uppercase tracking-widest")}
                />
              </Field>
              <Field
                id="custom-team-country"
                label={t("teamSelect.custom.fields.country")}
                error={errorFor("country")}
              >
                <select
                  id="custom-team-country"
                  value={country}
                  aria-invalid={errorFor("country") ? true : undefined}
                  aria-describedby={describedBy("custom-team-country", "country", false)}
                  onChange={(event) => setCountry(event.target.value)}
                  onBlur={() => touch("country")}
                  className={inputClass}
                >
                  <option value="">{t("teamSelect.custom.countryPlaceholder")}</option>
                  {nationalities.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div className="grid gap-5 sm:grid-cols-2">
                {colorField(
                  "custom-team-primary",
                  "primary",
                  t("teamSelect.custom.fields.primaryColor"),
                  t("teamSelect.custom.fields.pickPrimary"),
                  primary,
                  (value) => {
                    setPrimary(value);
                  },
                )}
                {colorField(
                  "custom-team-secondary",
                  "secondary",
                  t("teamSelect.custom.fields.secondaryColor"),
                  t("teamSelect.custom.fields.pickSecondary"),
                  secondary,
                  (value) => {
                    setSecondary(value);
                  },
                )}
              </div>

              <fieldset>
                <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t("teamSelect.custom.presets")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {BADGE_PRESETS.map(([p, s]) => {
                    const active = normalizeColor(primary) === p && normalizeColor(secondary) === s;
                    return (
                      <button
                        key={`${p}${s}`}
                        type="button"
                        aria-pressed={active}
                        aria-label={t("teamSelect.custom.preset", {
                          primary: p,
                          secondary: s,
                        })}
                        onClick={() => {
                          setPrimary(p);
                          setSecondary(s);
                        }}
                        className={cn(
                          "flex size-10 overflow-hidden rounded-lg border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          active ? "border-primary" : "border-border",
                        )}
                      >
                        <span className="h-full w-1/2" style={{ backgroundColor: p }} />
                        <span className="h-full w-1/2" style={{ backgroundColor: s }} />
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-4">
                <img
                  src={badgeSrc}
                  alt=""
                  width={32}
                  height={32}
                  className="size-8"
                  data-testid="badge-preview-small"
                />
                <p className="text-sm text-muted-foreground">
                  {t("teamSelect.custom.previewHint")}
                </p>
              </div>

              {lowContrast && (
                <p role="status" className="flex items-start gap-2 text-sm text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t("teamSelect.custom.errors.lowContrast")}
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <fieldset aria-describedby="custom-team-replace-notice">
                <legend className="mb-1 font-heading text-sm font-bold uppercase tracking-wider text-foreground">
                  {t("teamSelect.custom.replace.heading")}
                </legend>
                <p id="custom-team-replace-notice" className="mb-3 text-sm text-muted-foreground">
                  {t("teamSelect.custom.replace.notice")}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {teams.map((team) => {
                    const checked = team.id === replacesId;
                    const logo = getTeamLogoPath(team.id, team.logo_url);
                    return (
                      <label
                        key={team.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg border-2 p-3 transition-colors focus-within:ring-2 focus-within:ring-primary",
                          checked ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
                        )}
                      >
                        <input
                          type="radio"
                          name="custom-team-replace"
                          value={team.id}
                          checked={checked}
                          onChange={() => {
                            setReplacesId(team.id);
                            touch("replaces");
                            if (backend?.field === "replaces") ackBackend();
                          }}
                          className="size-4 accent-primary"
                        />
                        {logo && <img src={logo} alt="" className="size-8 shrink-0 object-contain" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-heading text-sm font-bold uppercase tracking-wide">
                            {team.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {team.short_name}
                            {" · "}
                            {team.reputation == null
                              ? "—"
                              : t("teamSelect.custom.replace.reputation", {
                                  value: team.reputation,
                                })}
                            {" · "}
                            {t(getReputationLabel(team.reputation ?? 0).labelKey)}
                          </span>
                        </span>
                        {team.id === defaultReplacementId(teams) && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                            {t("teamSelect.custom.replace.lowestReputation")}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                {errorFor("replaces") && (
                  <p id="custom-team-replaces-error" role="alert" className="mt-2 text-xs font-medium text-destructive">
                    {errorFor("replaces")}
                  </p>
                )}
              </fieldset>

              <section
                aria-labelledby="custom-team-summary"
                className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-4"
              >
                <img src={badgeSrc} alt="" width={32} height={32} className="size-12" />
                <div className="min-w-0">
                  <h3
                    id="custom-team-summary"
                    className="font-heading text-sm font-bold uppercase tracking-wider text-foreground"
                  >
                    {t("teamSelect.custom.summary.heading")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("teamSelect.custom.summary.text", {
                      name: name.trim(),
                      tag: badgeTag,
                      country: countryLabel,
                      replaced: replaced?.name ?? "—",
                    })}
                  </p>
                </div>
              </section>

              {error && !backend && (
                <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  <p className="font-heading text-sm font-bold uppercase tracking-wide">
                    {t("teamSelect.custom.errors.title")}
                  </p>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={goBack}
              disabled={isSubmitting}
              className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {step === 0 ? t("teamSelect.custom.actions.cancel") : t("teamSelect.custom.actions.back")}
            </button>
            {step < LAST_STEP ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!stepValid}
                className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
              >
                {t("teamSelect.custom.actions.next")}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!validation.ok || isSubmitting}
                className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold uppercase tracking-wider text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {t("teamSelect.custom.actions.confirm")}
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
