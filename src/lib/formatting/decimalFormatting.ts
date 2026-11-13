import i18n from "i18next";
import { getLocale } from "./dateFormatting";

const separators = new Map<string, string>();

function decimalSeparator(locale: string): string {
    let mark = separators.get(locale);
    if (mark === undefined) {
        try {
            mark = new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === "decimal")?.value ?? ".";
        } catch {
            mark = ".";
        }
        separators.set(locale, mark);
    }
    return mark;
}

/**
 * A decimal number the way the game language writes it: "6,1" in Spanish and German, "6.1" in
 * English. Digits and rounding are exactly `toFixed(fractionDigits)`; only the decimal mark follows
 * the language. `locale` is a game language ("es") or a BCP 47 tag; it defaults to the active
 * i18n language. Missing or non-finite values give `placeholder`.
 */
export function formatDecimal(
    value: number | null | undefined,
    fractionDigits: number,
    locale?: string,
    placeholder = "-",
): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return placeholder;
    const fixed = value.toFixed(fractionDigits);
    if (fractionDigits <= 0) return fixed;
    return fixed.replace(".", decimalSeparator(getLocale(locale ?? i18n.language)));
}
