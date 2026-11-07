import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

const LOCALES: Record<string, unknown> = { de, en, es, fr, it: itLocale, pt, "pt-BR": ptBR, tr };

/** Template trigger -> locale prefix the backend attaches (see `build_message_keyed` callers). */
export const TEMPLATE_FAMILIES: Record<string, string> = {
  match_preview: "be.msg.preMatch.templates",
  match_result: "be.msg.matchResult.templates",
};

// The data/ submodule owns the templates; skip when it is not checked out.
const TRIGGERS_DIR = join(process.cwd(), "data", "messages", "triggers");

function lookup(tree: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, tree);
}

function templatesByTrigger(): Map<string, string[]> {
  const byTrigger = new Map<string, string[]>();
  for (const dir of readdirSync(TRIGGERS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of readdirSync(join(TRIGGERS_DIR, dir.name)).filter((f) => f.endsWith(".json"))) {
      const tpl = JSON.parse(readFileSync(join(TRIGGERS_DIR, dir.name, file), "utf-8")) as {
        id: string;
        trigger: string;
      };
      byTrigger.set(tpl.trigger, [...(byTrigger.get(tpl.trigger) ?? []), tpl.id]);
    }
  }
  return byTrigger;
}

const placeholders = (text: string) => [...new Set(text.match(/\{\{\w+\}\}/g) ?? [])].sort();

describe.skipIf(!existsSync(TRIGGERS_DIR))("template message locale copy", () => {
  const byTrigger = existsSync(TRIGGERS_DIR) ? templatesByTrigger() : new Map<string, string[]>();

  for (const [trigger, prefix] of Object.entries(TEMPLATE_FAMILIES)) {
    describe(`${trigger} -> ${prefix}`, () => {
      it("has at least one template in data/", () => {
        expect(byTrigger.get(trigger)?.length ?? 0).toBeGreaterThan(0);
      });

      for (const [locale, tree] of Object.entries(LOCALES)) {
        it(`${locale} translates every template with the English placeholders`, () => {
          for (const id of byTrigger.get(trigger) ?? []) {
            for (const field of ["subject", "body"]) {
              const text = lookup(tree, `${prefix}.${id}.${field}`);
              expect(text, `${locale} ${prefix}.${id}.${field}`).toBeTypeOf("string");
              const english = lookup(en, `${prefix}.${id}.${field}`) as string;
              expect(placeholders(text as string), `${locale} ${id}.${field}`).toEqual(
                placeholders(english),
              );
            }
          }
        });
      }
    });
  }
});
