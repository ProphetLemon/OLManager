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
    expect(source).toMatch(/import \{ installBackGuard, registerNativeBack \} from "\.\/lib\/backGuard";/);
  });

  it("registers the native back-button listener on Android only, after the guard and before the render", () => {
    const lines = source.split("\n");
    const gate = lines.indexOf("if (isAndroidUserAgent(navigator.userAgent)) {");
    const call = lines.findIndex((line) => /^ {2}void registerNativeBack\(onBackButtonPress, /.test(line));
    const install = lines.indexOf("installBackGuard();");
    const render = lines.findIndex((line) => line.includes("createRoot("));
    expect(gate).toBeGreaterThan(install);
    expect(call).toBe(gate + 1);
    expect(lines[call + 1]).toBe("}");
    expect(call).toBeLessThan(render);
  });

  it("takes onBackButtonPress from the Tauri app API", () => {
    expect(source).toMatch(/import \{ onBackButtonPress \} from "@tauri-apps\/api\/app";/);
  });
});
