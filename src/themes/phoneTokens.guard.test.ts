import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { MIN_PHONE_ROOT_FONT_PX, phoneRootFontPx } from "@/ui-v2/uiScale";

const css = readFileSync(resolve(__dirname, "default.css"), "utf8");
const appCss = readFileSync(resolve(__dirname, "../App.css"), "utf8");

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.[\]"=*+?^${}()|\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `rule ${selector}`).not.toBeNull();
  return match![1];
}

/** Evaluates the lengths the text tokens use: `Nrem`, `Npx` and `max(...)` of those. */
function lengthPx(value: string, rootPx: number): number {
  const v = value.trim();
  const max = v.match(/^max\((.*)\)$/);
  if (max) return Math.max(...max[1].split(",").map((part) => lengthPx(part, rootPx)));
  const rem = v.match(/^([\d.]+)rem$/);
  if (rem) return Number(rem[1]) * rootPx;
  const px = v.match(/^([\d.]+)px$/);
  if (px) return Number(px[1]);
  throw new Error(`Unsupported text token value: ${value}`);
}

describe("phone touch floor", () => {
  it("keeps the desktop target floor at 24px", () => {
    expect(ruleBody(":root")).toMatch(/--target-min:\s*24px;/);
  });

  it("raises --target-min to the shared 48px hit on the phone, where Button and the primitives read it", () => {
    const android = ruleBody(':root[data-platform="android"]');
    expect(android).toContain("--hit: max(2.75rem, 48px);");
    expect(android).toContain("--target-min: var(--hit);");
  });

  it("does not touch --spacing on the phone (decided later, from measurements)", () => {
    expect(ruleBody(':root[data-platform="android"]')).not.toContain("--spacing");
  });
});

describe("phone text tokens", () => {
  const tokens = [...css.matchAll(/^\s*--(text-[a-z0-9]+):\s*([^;]+);/gm)].map((m) => ({ name: m[1], value: m[2] }));

  it("finds the whole text scale", () => {
    expect(tokens.map((t) => t.name)).toEqual([
      "text-2xs",
      "text-caption",
      "text-map",
      "text-nav",
      "text-entry",
      "text-section",
      "text-title",
      "text-ovr",
      "text-scoreboard",
    ]);
  });

  it.each([MIN_PHONE_ROOT_FONT_PX, phoneRootFontPx(), 18, 20])(
    "never computes under 12px at a %ipx phone root, with or without the px floors",
    (rootPx) => {
      for (const { name, value } of tokens) {
        expect(lengthPx(value, rootPx), `${name}: ${value}`).toBeGreaterThanOrEqual(12);
        // The px floors are a no-op on the phone: the rem part alone already clears 12px.
        const unfloored = value.match(/^max\(\s*([\d.]+rem)/)?.[1] ?? value;
        expect(lengthPx(unfloored, rootPx), `${name} without its px floor`).toBeGreaterThanOrEqual(12);
      }
    },
  );

  it("keeps the desktop px floors, which a 12px xsmall root still needs", () => {
    expect(css).toMatch(/--text-map:\s*max\(0\.75rem,\s*10px\);/);
    expect(css).toMatch(/--text-nav:\s*max\(0\.75rem,\s*10px\);/);
    expect(css).toMatch(/--text-entry:\s*max\(0\.875rem,\s*12px\);/);
  });
});

describe("the phone: Tailwind variant", () => {
  it("is declared in App.css under [data-form=\"phone\"]", () => {
    expect(appCss).toContain(
      '@custom-variant phone (&:where([data-form="phone"], [data-form="phone"] *));',
    );
  });

  it("compiles phone:* utilities under the attribute and leaves every other element alone", async () => {
    const declaration = appCss.match(/@custom-variant phone .+;/)?.[0];
    expect(declaration).toBeDefined();
    const compiler = await compile(`${declaration}\n@tailwind utilities;`);
    // Built at run time: Tailwind scans test files too, and a literal class here would ship in the bundle.
    const phoneHidden = ["phone", "hidden"].join(":");
    const out = compiler.build([phoneHidden, "hidden"]);
    expect(out).toMatch(/\[data-form="phone"\]/);
    expect(out).toMatch(/\.phone\\:hidden/);
    // The plain utility stays unscoped, so nothing changes without data-form.
    expect(out).toMatch(/\.hidden\s*\{/);
  });
});
