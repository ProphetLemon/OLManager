import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Chromium runs popstate listeners in registration order, and React Router registers its own
// when the app first mounts. The Back guard only works if it is registered before that, so
// main.tsx must install it ahead of the render.
describe("main.tsx Back guard", () => {
  const source = readFileSync(resolve(__dirname, "main.tsx"), "utf8");

  it("installs the Back guard before the app renders", () => {
    const install = source.indexOf("installBackGuard();");
    const render = source.indexOf("createRoot(");
    expect(install).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(-1);
    expect(install).toBeLessThan(render);
  });

  it("imports it from lib/backGuard", () => {
    expect(source).toMatch(/import \{ installBackGuard \} from "\.\/lib\/backGuard";/);
  });
});
