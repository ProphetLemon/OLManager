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

/** Exact (non-compact) amount, e.g. "$12,345", using the selected currency. */
export function formatCurrencyAmount(value: number): string {
    return `${activeCurrencySymbol()}${value.toLocaleString()}`;
}

export function formatVal(value: number, currency: string = activeCurrency): string {
    const symbol = currencySymbol(currency);
    if (value >= 1_000_000) {
        return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
        return `${symbol}${(value / 1_000).toFixed(0)}K`;
    }
    return `${symbol}${value}`;
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
