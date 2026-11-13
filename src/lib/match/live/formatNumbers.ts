/**
 * Gold as the screen writes it: whole numbers under a thousand, otherwise thousands with one
 * decimal and a "k" ("12.4k"). The decimal mark follows the locale. The sign is the caller's:
 * this reads the size of the amount, so a gap of -800 and one of +800 both give "800".
 */
export function compactGold(amount: number, locale?: string): string {
  const size = Number.isFinite(amount) ? Math.abs(amount) : 0;
  if (size < 1000) return String(Math.round(size));
  const thousands = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(size / 1000);
  return `${thousands}k`;
}
