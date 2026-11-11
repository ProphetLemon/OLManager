import en from "@/i18n/locales/en.json";

type Options = string | Record<string, unknown> | undefined;

const pluralRules = new Intl.PluralRules("en");

function lookup(key: string): string | undefined {
  let node: unknown = en;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Test double for i18next's `t` that resolves keys from the real `en.json`, so
 * component tests exercise the shipped English strings. Plural keys resolve through `key_one`/`key_other`. Unknown keys fall back
 * to the call's default string, `defaultValue`, or the key itself.
 */
export function translateFromEnglish(key: string, options?: Options): string {
  const vars = typeof options === "object" && options ? options : {};
  const fallback = typeof options === "string" ? options : (vars.defaultValue as string | undefined);
  const plural = typeof vars.count === "number" ? lookup(`${key}_${pluralRules.select(vars.count)}`) : undefined;
  const template = lookup(key) ?? plural ?? fallback ?? key;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, name: string) => String(vars[name] ?? ""));
}
