import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI = resolve(__dirname, "..");
// Built from parts so this guard does not count itself.
const NAME = ["build", "Call", "Items"].join("");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("one source for Needs your call (R18)", () => {
  it("lets only DashboardV2 build the call items under src/ui-v2", () => {
    const importers = sources(UI)
      .filter((file) => new RegExp(`\\b${NAME}\\b`).test(readFileSync(file, "utf8")))
      .map((file) => relative(UI, file));
    expect(importers).toEqual(["dashboard/DashboardV2.tsx"]);
  });
});
