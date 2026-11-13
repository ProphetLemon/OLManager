import i18n from "i18next";
import { getLocale } from "./dateFormatting";
import { formatDecimal } from "@/lib/formatting/decimalFormatting";

export function calcAge(dob: string, asOfDate: string): number {
    const birthDate = new Date(dob);
    const currentDate = new Date(asOfDate);
    if (Number.isNaN(birthDate.getTime()) || Number.isNaN(currentDate.getTime())) {
        return 0;
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
