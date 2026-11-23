import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Chromium runs popstate listeners in registration order, and React Router registers its own
// when the app first mounts. The Back guard only works if it is registered before that, so
// main.tsx must install it ahead of the render.
describe("main.tsx Back guard", () => {
  const source = readFileSync(resolve(__dirname, "main.tsx"), "utf8");

  it("installs the Back guard before the app renders, as a top-level statement", () => {
    // A line that is exactly the call, with no indentation: not inside a function or branch.
    const lines = source.split("\n");
    const install = lines.indexOf("installBackGuard();");
    const render = lines.findIndex((line) => line.includes("createRoot("));
    expect(install).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(-1);
    expect(install).toBeLessThan(render);
  });

  it("imports it from lib/backGuard", () => {
    expect(source).toMatch(/import \{ installBackGuard \} from "\.\/lib\/backGuard";/);
  });
});
