import type { TFunction } from "i18next";

const MISSING = "\u0000";

/**
 * Resolves the label of an inbox message category.
 *
 * Labels live under `inbox.categories.*`, but the `training` key is registered in
 * lowercase while the backend sends `Training`. Try the category as sent, then with a
 * lowercase first letter, then fully lowercase, and fall back to the raw category so a
 * chip or badge is never a raw translation key.
 */
export function resolveInboxCategoryLabel(t: TFunction, category: string): string {
  const lowerFirst = category.charAt(0).toLowerCase() + category.slice(1);
  for (const candidate of new Set([category, lowerFirst, category.toLowerCase()])) {
    const key = `inbox.categories.${candidate}`;
    const label = t(key, { defaultValue: MISSING }) as string;
    if (label && label !== MISSING && label !== key) return label;
  }
  return category;
}
