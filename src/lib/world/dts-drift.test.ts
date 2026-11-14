// @vitest-environment node
// The type files next to the world scripts are written by hand. Nothing type-checks them against the modules (the
// scripts are plain .mjs), so a new or renamed export can leave its .d.mts behind. This compares the value exports.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./poolFixtures";

const libs = ["scripts/world/lib", "scripts/stats/lib"].map((dir) => path.join(root, dir));

/** Value exports a .d.mts declares: const, function and class declarations and `export { a, b } from`. Types are not runtime values. */
function declaredValues(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/^export\s+(?:declare\s+)?(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

describe("hand-written .d.mts files", () => {
  const pairs = libs.flatMap((dir) =>
    fs.readdirSync(dir).filter((file) => file.endsWith(".d.mts")).map((file) => ({ dir, name: file.replace(/\.d\.mts$/, "") })),
  );

  it("finds the declaration files it is meant to check", () => {
    expect(pairs.length).toBeGreaterThan(30);
    expect(pairs.map((p) => p.name)).toEqual(expect.arrayContaining(["pool", "pool-rating", "pool-report", "skill"]));
  });

  it("reads declarations the way the compiler does (export forms)", () => {
    const sample = [
      "export const A: number;", "export declare function b(): void;", "export interface NotAValue {}", "export type AlsoNot = string;",
      'export { C, d as D } from "./x.mjs";', 'export type { E } from "./x.mjs";', "export class F {}",
    ].join("\n");
    expect(declaredValues(sample)).toEqual(["A", "C", "D", "F", "b"]);
  });

  for (const { dir, name } of pairs) {
    it(`${path.basename(path.dirname(dir))}/${path.basename(dir)}/${name}.d.mts declares exactly what ${name}.mjs exports`, async () => {
      const module = await import(/* @vite-ignore */ path.join(dir, `${name}.mjs`));
      const declared = declaredValues(fs.readFileSync(path.join(dir, `${name}.d.mts`), "utf8"));
      expect(declared).toEqual(Object.keys(module).sort());
    });
  }
});
