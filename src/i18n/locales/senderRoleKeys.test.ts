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

// The data/ submodule owns the sender definitions; skip when it is not checked out.
const SENDERS_DIR = join(process.cwd(), "data", "messages", "senders");

function lookup(tree: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, tree);
}

function referencedKeys(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(SENDERS_DIR).filter((f) => f.endsWith(".json"))) {
    const sender = JSON.parse(readFileSync(join(SENDERS_DIR, file), "utf-8")) as {
      name_key?: string;
      role_key?: string;
    };
    if (sender.name_key) keys.add(sender.name_key);
    if (sender.role_key) keys.add(sender.role_key);
  }
  return [...keys].sort();
}

describe.skipIf(!existsSync(SENDERS_DIR))("message sender and role keys", () => {
  it("references at least one sender key", () => {
    expect(referencedKeys().length).toBeGreaterThan(0);
  });

  for (const [lang, tree] of Object.entries(LOCALES)) {
    it(`${lang} defines every be.sender.* and be.role.* key used by data/messages/senders`, () => {
      const missing = referencedKeys().filter((key) => {
        const value = lookup(tree, key);
        return typeof value !== "string" || value.trim() === "";
      });
      expect(missing).toEqual([]);
    });
  }
});
