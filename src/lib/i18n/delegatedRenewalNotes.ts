import { formatCurrencyAmount } from "../formatting/valueFormatting";

/**
 * The backend sends the wage of a delegated-renewal note as a bare number in a string
 * (`note_params.wage`). The locale texts do not carry a currency symbol, so format it here.
 * A value that is not a plain number is returned untouched.
 */
export function formatDelegatedNoteParams(
    params: Record<string, string> | undefined,
): Record<string, string> | undefined {
    const raw = params?.wage;
    if (!params || raw === undefined || raw.trim() === "") {
        return params;
    }

    const wage = Number(raw);
    return Number.isFinite(wage)
        ? { ...params, wage: formatCurrencyAmount(wage) }
        : params;
}
