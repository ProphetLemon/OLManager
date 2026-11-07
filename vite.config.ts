import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function manualChunks(id: string): string | undefined {
  if (id.indexOf("node_modules") === -1) {
    return undefined;
  }

  if (id.indexOf("react-router-dom") !== -1) {
    return "router";
  }

  if (
    id.indexOf("react") !== -1 ||
    id.indexOf("react-dom") !== -1 ||
    id.indexOf("scheduler") !== -1
  ) {
    return "react-vendor";
  }

  if (id.indexOf("@tauri-apps") !== -1) {
    return "tauri";
  }

  if (id.indexOf("i18next") !== -1) {
    return "i18n";
  }

  if (id.indexOf("lucide-react") !== -1) {
    return "icons";
  }

  return undefined;
}

// https://vite.dev/config/
export default defineConfig(async () => {
  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["src/test-setup.ts"],
      // Number/Date formatting uses the host locale (`toLocaleString()`), so
      // pin it: expectations such as "€40,000" must not depend on the machine.
      env: { LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" },
      // @ts-expect-error process is a nodejs global
      forbidOnly: Boolean(process.env.CI),
      coverage: {
        exclude: ["src/i18n/locales/**", "src/**/*.test.{ts,tsx}", "src/test-setup.ts"],
      },
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    build: {
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: "127.0.0.1",
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`, and the data/photo dirs
        //    the importer writes into — otherwise a bulk import (~1800 photos)
        //    streaming into publicDir triggers a full-reload storm that blanks
        //    the page. These are server-owned assets, not part of the module
        //    graph, so there's nothing to hot-reload anyway.
        ignored: [
          "**/src-tauri/**",
          "**/public/player-photos/**",
          "**/public/teams-icons/**",
          "**/public/competitions-icons/**",
          "**/public/staff-photos/**",
          "**/data/**",
        ],
      },
    },
  };
});
