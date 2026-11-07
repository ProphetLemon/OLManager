import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

const SLIM_JSON_TARGETS = [
  "data/champions/champion-relationships.v1.json",
  "data/champions/champion-timings.v1.json",
];

/**
 * Build-only: the champion datasets carry per-row provenance and review
 * metadata for auditing (~2 MB), but the app only reads the fields kept here.
 * Slimming them at bundle time keeps the data out of the size budget without
 * touching the source files or any consumer.
 */
function slimChampionDatasets(): Plugin {
  const prefix = "\0slim-dataset:";
  return {
    name: "slim-champion-datasets",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.endsWith(".json")) return null;
      const resolved = path.resolve(path.dirname(importer), source);
      const normalized = resolved.split(path.sep).join("/");
      return SLIM_JSON_TARGETS.some((t) => normalized.endsWith(t))
        ? prefix + resolved.replace(/\.json$/, ".slim")
        : null;
    },
    load(id) {
      if (!id.startsWith(prefix)) return null;
      const file = id.slice(prefix.length).replace(/\.slim$/, ".json");
      const raw = JSON.parse(readFileSync(file, "utf-8"));
      let slim: unknown;
      if (file.endsWith("champion-relationships.v1.json")) {
        slim = {
          schemaVersion: raw.schemaVersion,
          dataset: raw.dataset,
          counters: raw.counters.map(
            (c: { source: string; target: string; value: number }) => ({
              source: c.source,
              target: c.target,
              value: c.value,
            }),
          ),
        };
      } else {
        slim = {
          schemaVersion: raw.schemaVersion,
          dataset: raw.dataset,
          defaultTiming: raw.defaultTiming,
          data: Object.fromEntries(
            Object.entries(raw.data as Record<string, { timing: string }>).map(
              ([key, row]) => [key, { timing: row.timing }],
            ),
          ),
        };
      }
      return `export default ${JSON.stringify(slim)};`;
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function manualChunks(id: string): string | undefined {
  if (id.indexOf("node_modules") === -1) {
    return undefined;
  }

  // Match whole package directories: a bare "react" substring also catches
  // react-i18next, @base-ui/react, country-flag-icons/react and friends.
  if (/[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react-router|react-router-dom)[\\/]/.test(id)) {
    return "router";
  }

  if (/[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler)[\\/]/.test(id)) {
    return "react-vendor";
  }

  if (id.indexOf("country-flag-icons") !== -1) {
    return "flags";
  }

  if (id.indexOf("@base-ui") !== -1 || id.indexOf("@floating-ui") !== -1) {
    return "base-ui";
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
    plugins: [react(), tailwindcss(), slimChampionDatasets()],
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
