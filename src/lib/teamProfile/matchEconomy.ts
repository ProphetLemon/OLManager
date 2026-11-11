/** Shown where a match record holds no figure (the live match path does not record damage). */
export const NOT_RECORDED = "—";

/** A played game always earns gold and deals damage, so zero means "not recorded", never "none". */
export function formatRecordedNumber(value: number, locale: string): string {
  return value > 0 ? new Intl.NumberFormat(locale).format(value) : NOT_RECORDED;
}

export function formatMatchEconomy(goldEarned: number, damageToChampions: number, locale: string): string {
  return `${formatRecordedNumber(goldEarned, locale)} / ${formatRecordedNumber(damageToChampions, locale)}`;
}
