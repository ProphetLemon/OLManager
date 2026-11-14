import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AcademySearchFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * The academy roster's search box. The placeholder is a whole sentence ("Buscar jugadores de la
 * academia..."), so the field is wide enough for the longest locale and only narrows, never clips,
 * when the card is narrower still.
 */
export function AcademySearchField({ value, onChange }: AcademySearchFieldProps) {
  const { t } = useTranslation();
  const label = t("youthAcademy.searchPlaceholder", "Search...");
  return (
    <div className="relative max-w-full">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="h-7 w-72 max-w-full rounded-md border border-border bg-muted/30 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/50"
      />
    </div>
  );
}
