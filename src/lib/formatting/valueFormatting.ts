import i18n from "i18next";
import { getLocale } from "./dateFormatting";
import { formatDecimal } from "@/lib/formatting/decimalFormatting";

const MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
];

function utcDate(year: number, monthIndex: number, day: number): Date | null {
    const date = new Date(Date.UTC(year, monthIndex, day));
    const valid =
        date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex && date.getUTCDate() === day;
    return valid ? date : null;
}

/**
 * A date of birth in the two forms the game core reads (`YYYY-MM-DD` and
 * `Month D, YYYY`), as a UTC date; `null` for a missing or unreadable one.
 * Keep it in step with `parse_date_of_birth` in `olm_core/src/player_age.rs`.
 */
export function parseDateOfBirth(raw: string | null | undefined): Date | null {
    const text = raw?.trim();
    if (!text) return null;

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (iso) return utcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    const named = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text);
    if (named) {
        const name = named[1].toLowerCase();
        const monthIndex = MONTH_NAMES.findIndex((month) => month === name || month.slice(0, 3) === name);
        return monthIndex < 0 ? null : utcDate(Number(named[3]), monthIndex, Number(named[2]));
    }
    return null;
}

/**
 * Age on `asOfDate`, or `null` when the date of birth is missing or unreadable: the game
 * draws an age for those players, the screens do not show an invented one.
 */
export function calcAge(dob: string | null | undefined, asOfDate: string): number | null {
    const birthDate = parseDateOfBirth(dob);
    const currentDate = new Date(asOfDate);
    if (!birthDate || Number.isNaN(currentDate.getTime())) {
        return null;
    }
    let age = currentDate.getUTCFullYear() - birthDate.getUTCFullYear();

    if (
        currentDate.getUTCMonth() < birthDate.getUTCMonth() ||
        (currentDate.getUTCMonth() === birthDate.getUTCMonth() &&
            currentDate.getUTCDate() < birthDate.getUTCDate())
    ) {
        age -= 1;
    }

    return age;
}

/** An age for a table cell: the number, or a dash when it is unknown. */
export function formatAge(age: number | null): string {
    return age === null ? "—" : String(age);
}

/** Sort comparison on ages (`factor` 1 ascending, -1 descending) that keeps unknown ages last. */
export function compareAgesUnknownLast(a: number | null, b: number | null, factor: 1 | -1): number {
    if (a === null || b === null) {
        if (a === b) return 0;
        return a === null ? 1 : -1;
    }
    return (a - b) * factor;
}

let activeCurrency = "EUR";

/** Keeps formatters in sync with the currency chosen in settings (see settingsStore). */
export function setActiveCurrency(currency: string): void {
    activeCurrency = currency;
}

export function getActiveCurrency(): string {
    return activeCurrency;
}

/** Symbol for the currency currently selected in settings. */
export function activeCurrencySymbol(): string {
    return currencySymbol(activeCurrency);
}

/** Plain number grouped and separated the way the app language writes it ("12.345" in Spanish). */
export function formatNumber(value: number): string {
    return value.toLocaleString(getLocale(i18n.language));
}

/** Exact (non-compact) amount, e.g. "$12,345", using the selected currency. */
export function formatCurrencyAmount(value: number): string {
    const sign = value < 0 ? "-" : "";
    return `${sign}${activeCurrencySymbol()}${formatNumber(Math.abs(value))}`;
}

export function formatVal(value: number, currency: string = activeCurrency): string {
    const symbol = currencySymbol(currency);
    // The sign goes before the symbol ("-€51K"), never between symbol and number.
    const sign = value < 0 ? "-" : "";
    const magnitude = Math.abs(value);
    if (magnitude >= 1_000_000) {
        return `${sign}${symbol}${formatDecimal(magnitude / 1_000_000, 1)}M`;
    }
    if (magnitude >= 1_000) {
        return `${sign}${symbol}${(magnitude / 1_000).toFixed(0)}K`;
    }
    return `${sign}${symbol}${magnitude}`;
}

export function currencySymbol(currency: string): string {
    switch (currency) {
        case "USD": return "$";
        case "GBP": return "£";
        default: return "€";
    }
}

export function formatWeeklyAmount(
    formattedAmount: string,
    weeklySuffix: string,
): string {
    return `${formattedAmount}${weeklySuffix}`;
}
