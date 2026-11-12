import { useId } from "react";
import { useTranslation } from "react-i18next";

/** What the staff advises for the week. The sentences come from `buildStaffSuggestions`, not from this component. */
export function ScrimStaffSuggestions({ suggestions }: { suggestions: readonly string[] }) {
  const { t } = useTranslation();
  const headingId = useId();
  if (suggestions.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-slot="scrim-staff-suggestions"
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 text-card-foreground sm:p-5"
    >
      <h2 id={headingId} className="font-heading text-lg font-semibold uppercase leading-tight tracking-wide">
        {t("training.scrims.staffSuggestions")}
      </h2>
      <ul className="flex flex-col">
        {suggestions.map((suggestion) => (
          <li key={suggestion} className="border-t border-line py-3 text-sm first:border-t-0 first:pt-0 last:pb-0">
            {suggestion}
          </li>
        ))}
      </ul>
    </section>
  );
}
